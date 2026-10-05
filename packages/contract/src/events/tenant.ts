// tenant 模块发出的事件的载荷（docs/api/x01-events-jobs.md 第 3.2 节；01 分组 第 4 节）。
// 载荷规则见 x01 第 2.3 节 P1–P7：{ v: 数字, … }，只放 id 与枚举；迁移事件带三个迁移键（P4），由 flow.transition() 补上。
// 现在只有建主体那一个用例发的两条（W1-03）；门店停用、成员、邀请的事件随 M2。
import { IdSchema, orNull } from "../common/index.js";
import { ENTITY_LIFECYCLE, STORE_LIFECYCLE } from "../enums/index.js";
import { zodEnum } from "../enums/zod.js";
import { z } from "../zod.js";

/** entity.created：迁移码 entity.create（02:523），聚合 entity */
export const entityCreatedPayload = z.strictObject({
  v: z.literal(1),
  entityId: IdSchema,
  /** 同事务建的首店 */
  firstStoreId: IdSchema,
  /** 老板（商家用户 id） */
  ownerUserId: IdSchema,
  fromState: orNull(zodEnum(ENTITY_LIFECYCLE)),
  toState: zodEnum(ENTITY_LIFECYCLE),
  transition: z.literal("entity.create"),
});

/** store.created：迁移码 store.create（02:607），聚合 store */
export const storeCreatedPayload = z.strictObject({
  v: z.literal(1),
  storeId: IdSchema,
  entityId: IdSchema,
  isFirstStore: z.boolean(),
  fromState: orNull(zodEnum(STORE_LIFECYCLE)),
  toState: zodEnum(STORE_LIFECYCLE),
  transition: z.literal("store.create"),
});

export const payloads = {
  "entity.created": entityCreatedPayload,
  "store.created": storeCreatedPayload,
} as const;
