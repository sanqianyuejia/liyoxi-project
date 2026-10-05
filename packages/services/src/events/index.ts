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
