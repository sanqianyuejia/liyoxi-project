// 订阅一侧（W1-11a 的账本侧）：建周期与发放计划、付清后的履约、三条不变量。
export { blockedResult, FulfillBlockedError, isNotBlockage } from "./blocked.js";
export { createFulfillment, fulfillOpKey } from "./fulfill.js";
export type { Fulfillment, FulfillInput, FulfillOutcome } from "./fulfill.js";
export { subscriptionInvariants } from "./invariants.js";
export { FULFILL_STEPS } from "./types.js";
export type { FulfillDeps, FulfillStep } from "./types.js";
