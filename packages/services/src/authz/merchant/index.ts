// 商家侧授权（W1-04）：能力点判定、门店与主体的数据范围。后台的判定与数据范围在上一级目录（W1-01a）。
export { assertCapability, hasCapability, MERCHANT_STANDINGS, standingOf } from "./capabilities.js";
export type { MerchantStanding, StoreMode } from "./capabilities.js";
export { entityScopeOf, ScopeError, storeScopeOf } from "./scope.js";
export type { EntityScope, StoreScope } from "./scope.js";
