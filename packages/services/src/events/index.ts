// events：出站事件（W0-15）。用法见本目录的 README.md。
export { createEvents } from "./runtime.js";
export type { Events, EventsOptions } from "./runtime.js";
export { EventEmitError } from "./emit.js";
export type { EmitContext, EmitInput, EmitRefusal, EmitResult } from "./emit.js";
export { TEST_NAME_PREFIX } from "./catalog.js";
export type { TestEventDefinition } from "./catalog.js";
export { SubscriberRegistryError } from "./subscribers.js";
export type { SubscriberEntry, SubscriberTable } from "./subscribers.js";
export { EXPAND_BATCH_SIZE } from "./expand.js";
export type { ExpandResult } from "./expand.js";
export {
  findI8Violations,
  I8_DELIVERY_MAX_OVERDUE_MS,
  I8_EVENT_MAX_AGE_MS,
  I8_MAX_VIOLATIONS,
} from "./invariants.js";
export {
  assertAggregateTables,
  emittedAggregateTypes,
  findMissingAggregateTables,
} from "./aggregates.js";
export { registration } from "./register.js";
// W0-23：派发认领、消费与失败短事务（退避、死信）
export {
  claimDeliveries,
  consumeDelivery,
  DELIVERY_BACKOFF_SEC,
  DELIVERY_LEASE_SEC,
  DELIVERY_MAX_ATTEMPTS,
  deliveryJobId,
  dispatchDue,
  DISPATCH_BATCH_SIZE,
  errorSummary,
  OUTBOX_QUEUE,
  UNKNOWN_EVENT_DELAY_SEC,
  UNKNOWN_EVENT_GIVE_UP_SEC,
} from "./dispatch.js";
export type {
  ClaimedDelivery,
  ClaimResult,
  ConsumeOutcome,
  DeliveryRef,
  DispatchDeps,
  DispatchOptions,
  DispatchResult,
} from "./dispatch.js";
