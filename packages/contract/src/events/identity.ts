// identity 模块发出的事件的载荷（docs/api/x01-events-jobs.md 第 3.2 节；02 分组 第 5 节“事件目录”）。
// 载荷规则见 x01 第 2.3 节 P1–P7：{ v: 数字, … }，只放 id 与枚举；迁移事件带三个迁移键（P4），由 flow.transition() 补上。
// 现在只有手机号登录发的两条（W1-04）；禁用、启用、注销、换绑的事件随 M2。
import { IdSchema, orNull } from "../common/index.js";
import { MERCHANT_USER_STATUS, SOURCE_TYPE } from "../enums/index.js";
import { zodEnum } from "../enums/zod.js";
import { z } from "../zod.js";

/** 建号的途径：首次手机号登录，或老板更换时按号码建号（A143；后者随 M2） */
export const MERCHANT_USER_REGISTERED_VIA = ["phone_login", "owner_transfer"] as const;

/** merchant_user.registered：迁移码 merchant_user.register（02:125），聚合 merchant_user */
export const merchantUserRegisteredPayload = z.strictObject({
  v: z.literal(1),
  merchantUserId: IdSchema,
  via: z.enum(MERCHANT_USER_REGISTERED_VIA),
  sourceType: zodEnum(SOURCE_TYPE),
  /** 判定来源时命中的登记码；没有命中为空 */
  sourceReferralCodeId: orNull(IdSchema),
  fromState: orNull(zodEnum(MERCHANT_USER_STATUS)),
  toState: zodEnum(MERCHANT_USER_STATUS),
  transition: z.literal("merchant_user.register"),
});

/** merchant_user.wechat_bound：新微信绑定到有成员关系的账号（不是状态迁移），聚合 merchant_user */
export const merchantUserWechatBoundPayload = z.strictObject({
  v: z.literal(1),
  merchantUserId: IdSchema,
  /** 刚绑定的微信身份：通知侧据此排除它 */
  wechatIdentityId: IdSchema,
});

export const payloads = {
  "merchant_user.registered": merchantUserRegisteredPayload,
  "merchant_user.wechat_bound": merchantUserWechatBoundPayload,
} as const;
