// billing 的账本与订阅事件的载荷（docs/api/x01-events-jobs.md 第 3.7 节；W1-10）。
// 载荷规则见 x01 第 2.3 节 P1–P7：{ v: 数字, … }，只放 id、业务日期、关键数字与枚举；不放 P5 列的内容。
// 这里交的是账本内核发的九个：七个 billing.points.*，两个由 advance 发的 billing.subscription.*。
// 其余 billing 事件（开通、续费预约、升级、退款、付款单等）由发它们的包来交。
import { IdSchema, InstantSchema, orNull, PointsSchema } from "../common/scalars.js";
import { BILLING_ORDER_TYPE, POINT_HOLD_PURPOSE } from "../enums/index.js";
import { zodEnum } from "../enums/zod.js";
import { z } from "../zod.js";

const positivePoints = PointsSchema.positive();
const nonNegativePoints = PointsSchema.nonnegative();
/** point_hold.ref_type：与 purpose 同一组取值 */
const holdRefType = zodEnum(POINT_HOLD_PURPOSE);

/** billing.points.granted：发放（grant_schedule → granted）。去重键 billing.points.granted:{grantScheduleId} */
export const pointsGrantedPayload = z.strictObject({
  v: z.literal(1),
  entityId: IdSchema,
  termId: IdSchema,
  grantScheduleId: IdSchema,
  points: positivePoints,
  /** 第几个月，从 0 起（= grant_schedule.month_no） */
  monthIndex: z.int().nonnegative(),
});

/** billing.points.purchased：加购积分入账 */
export const pointsPurchasedPayload = z.strictObject({
  v: z.literal(1),
  entityId: IdSchema,
  billingOrderId: IdSchema,
  points: positivePoints,
});

const holdMove = {
  v: z.literal(1),
  entityId: IdSchema,
  pointHoldId: IdSchema,
  points: positivePoints,
  refType: holdRefType,
  refId: IdSchema,
} as const;

/** billing.points.held：冻结 */
export const pointsHeldPayload = z.strictObject(holdMove);

/** billing.points.captured：冻结转扣减 */
export const pointsCapturedPayload = z.strictObject(holdMove);

/** billing.points.returned：释放或退回。三个数量之和 = 这次退回的数量 */
export const pointsReturnedPayload = z.strictObject({
  v: z.literal(1),
  entityId: IdSchema,
  pointHoldId: IdSchema,
  /** 回到原批次 */
  returnedPoints: nonNegativePoints,
  /** 转为加购积分 */
  convertedPoints: nonNegativePoints,
  /** 不予退回 */
  forfeitedPoints: nonNegativePoints,
});

/** billing.points.expired：期末清零。去重键 billing.points.expired:{termId} */
export const pointsExpiredPayload = z.strictObject({
  v: z.literal(1),
  entityId: IdSchema,
  termId: IdSchema,
  expiredPoints: positivePoints,
});

/** billing.points.adjusted：积分调整入账。deltaPoints 带符号，不为 0 */
export const pointsAdjustedPayload = z.strictObject({
  v: z.literal(1),
  entityId: IdSchema,
  pointAdjustmentRequestId: IdSchema,
  deltaPoints: PointsSchema.refine((value) => value !== 0, "增减数不为 0"),
});

/** billing.subscription.rolled_over：预约周期接续生效 */
export const subscriptionRolledOverPayload = z.strictObject({
  v: z.literal(1),
  termId: IdSchema,
  prevTermId: orNull(IdSchema),
  entityId: IdSchema,
});

/** billing.subscription.expired：到期且没有预约周期 */
export const subscriptionExpiredPayload = z.strictObject({
  v: z.literal(1),
  termId: IdSchema,
  entityId: IdSchema,
  endedAt: InstantSchema,
});

/** billing.subscription.activated：无生效订阅时付清套餐，周期当场生效（W1-11a）。去重键按周期 */
export const subscriptionActivatedPayload = z.strictObject({
  v: z.literal(1),
  termId: IdSchema,
  entityId: IdSchema,
  planId: IdSchema,
  startsAt: InstantSchema,
  endsAt: InstantSchema,
  sourceBillingOrderId: IdSchema,
});

/** billing.subscription.renewal_scheduled：生效期间付清套餐，多排一个预约周期（W1-11a） */
export const subscriptionRenewalScheduledPayload = z.strictObject({
  v: z.literal(1),
  termId: IdSchema,
  entityId: IdSchema,
  startsAt: InstantSchema,
  endsAt: InstantSchema,
});

/** billing.order_fulfilled：fulfill() 返回 done（W1-11a）。加购没有周期，termId 为空 */
export const orderFulfilledPayload = z.strictObject({
  v: z.literal(1),
  billingOrderId: IdSchema,
  entityId: IdSchema,
  contentType: zodEnum(BILLING_ORDER_TYPE),
  termId: orNull(IdSchema),
});

export const payloads = {
  "billing.points.granted": pointsGrantedPayload,
  "billing.points.purchased": pointsPurchasedPayload,
  "billing.points.held": pointsHeldPayload,
  "billing.points.captured": pointsCapturedPayload,
  "billing.points.returned": pointsReturnedPayload,
  "billing.points.expired": pointsExpiredPayload,
  "billing.points.adjusted": pointsAdjustedPayload,
  "billing.subscription.rolled_over": subscriptionRolledOverPayload,
  "billing.subscription.expired": subscriptionExpiredPayload,
  "billing.subscription.activated": subscriptionActivatedPayload,
  "billing.subscription.renewal_scheduled": subscriptionRenewalScheduledPayload,
  "billing.order_fulfilled": orderFulfilledPayload,
} as const;
