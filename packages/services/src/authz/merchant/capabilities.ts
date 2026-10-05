// 商家端能力点的判定（W1-04；约定 C56、C66；D4 第 5.2 节）。矩阵只有契约里那一份
//（packages/contract/src/authz/capabilities.ts：键 × 老板、店员、已停用门店的老板），这里只是查它。
// 能力点只回答“这个角色在这种门店状态下能不能做这类事”；门店是否认证、套餐是否生效由各业务服务判断。
// me.*、cart.* 这类组键是登记的单个键，不是通配：按整个键查，不做前缀匹配（裁决 A128）。
import { capabilityByKey } from "@liyoxi/contract/authz";
import type { CapabilityKey } from "@liyoxi/contract/authz";
import type { MerchantRole } from "@liyoxi/contract/enums";

import { AppError } from "../../kernel/index.js";

/** 判定用的三种身份：矩阵的三列 */
export const MERCHANT_STANDINGS = ["owner", "clerk", "archivedOwner"] as const;
export type MerchantStanding = (typeof MERCHANT_STANDINGS)[number];

/** 门店上下文：active 正常；archived 是老板进了自己停用的门店（收尾上下文） */
export type StoreMode = "active" | "archived";

/** 角色 × 门店状态 → 矩阵的哪一列。店员进不了已停用的门店（成员关系解析那一步已拦） */
export function standingOf(role: MerchantRole, storeMode: StoreMode): MerchantStanding {
  if (role === "clerk") return "clerk";
  return storeMode === "archived" ? "archivedOwner" : "owner";
}

/** 这种身份有没有这个能力点。键没登记即没有（路由写错了键不会被放行） */
export function hasCapability(standing: MerchantStanding, key: string): boolean {
  return capabilityByKey(key)?.[standing].allowed === true;
}

/**
 * 没有即抛：店员是 ROLE_FORBIDDEN；已停用门店的老板超出收尾范围是 STORE_ARCHIVED（约定 C17）。
 * 中间件按路由的 x-capability 调一次；服务层的入口函数可以再调一次（防旁路）。
 */
export function assertCapability(standing: MerchantStanding, key: CapabilityKey | string): void {
  if (hasCapability(standing, key)) return;
  throw new AppError(standing === "archivedOwner" ? "STORE_ARCHIVED" : "ROLE_FORBIDDEN");
}
