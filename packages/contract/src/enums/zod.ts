// Zod 枚举由纯常量派生，不另抄取值（任务书 W0-09a 第 11 节第 2 项）。
// 本文件带 Zod 运行时：只从包入口（@liyoxi/contract）给出，不进 ./enums 子路径。
import { z } from "../zod.js";

import type { EnumDef } from "./define.js";
import { ACTOR_TYPE, CLIENT, MERCHANT_ROLE } from "./shared.js";

/** 由枚举常量得到 Zod 枚举。各域的结构用它，取值只有契约里那一份 */
export function zodEnum<V extends string>(def: EnumDef<V>) {
  return z.enum(def.values);
}

/** 操作人的三个枚举（06 第 3.3 节）：类型、客户端来源、商家角色快照。内核的事务单元、幂等、审计、状态历史都用 */
export const ActorTypeSchema = zodEnum(ACTOR_TYPE);
export const ClientSchema = zodEnum(CLIENT);
export const MerchantRoleSchema = zodEnum(MERCHANT_ROLE);
