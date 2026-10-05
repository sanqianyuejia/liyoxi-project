// 冻结单的计价与规则快照 point_hold.pricing_snapshot（PricingSnapshot；W1-10）。
// 依据：07 分组 第 4.5 节；09 分组 第 4.2 节（订单项、广告上存的是同一份）；D1 第 5.3 节。
// 由 billing 的 hold 在账户锁内按账本时钟生成；之后的扣减、取消、退回、报表一律读它，不读当前的价目与参数。
// 快照直接保存用到的参数值，不保存参数修订号。按 kind 区分三种：订剧、广告、超次修改。
import { BpSchema, IdSchema, InstantSchema, orNull, PointsSchema } from "../common/scalars.js";
import { DRAMA_PRICE_REVISION_MODE, HEAT_TIER, PRODUCTION_MODEL } from "../enums/index.js";
import { zodEnum } from "../enums/zod.js";
import { z } from "../zod.js";
import { BILLING_PARAM_VALUES } from "./params.js";

const bp = BpSchema.min(0).max(10_000);
const positivePoints = PointsSchema.positive();
const deduction = BILLING_PARAM_VALUES.cancelDeductionBp.shape;

/** 三种快照都带的：冻结时的生效周期与版本、折扣、应扣积分、退回去向、计价时刻 */
const common = {
  v: z.literal(1),
  termId: IdSchema,
  planId: IdSchema,
  planRevisionId: IdSchema,
  /** 周期的制作模型 */
  planModel: zodEnum(PRODUCTION_MODEL),
  /** 折扣 R */
  discountBp: bp,
  /** 应扣积分，等于 point_hold.qty */
  S: positivePoints,
  /** 下单时的“原周期已结束的退回去向”；退回时读它，不读当前参数 */
  expiredTermRefund: BILLING_PARAM_VALUES.expiredTermRefund,
  /** 计价时刻（账本时钟） */
  quotedAt: InstantSchema,
} as const;

/** 订一部剧：S = round(P × R × (1 + T)) */
export const DramaPricingSnapshotSchema = z.strictObject({
  ...common,
  kind: z.literal("drama"),
  dramaId: IdSchema,
  /** 剧目积分价 */
  P: positivePoints,
  priceSource: z.strictObject({
    mode: zodEnum(DRAMA_PRICE_REVISION_MODE),
    tier: orNull(zodEnum(HEAT_TIER)),
    dramaPriceRevisionId: orNull(IdSchema),
    tierRevisionId: orNull(IdSchema),
  }),
  /** 是否按次选用顶级模型 */
  topModelSelected: z.boolean(),
  /** 实际适用的加扣比例 T：旗舰版或未选用时为 0 */
  surchargeBp: bp,
  formula: z.strictObject({
    code: z.literal("drama"),
    args: z.strictObject({ P: positivePoints, R: bp, T: bp }),
  }),
  /** 下单时的取消扣除比例：订购的四个阶段 */
  cancelDeductionBp: z.strictObject({
    planConfirm: deduction.planConfirm,
    adAndSample: deduction.adAndSample,
    samplePending: deduction.samplePending,
    postSample: deduction.postSample,
  }),
});

const adCommon = {
  ...common,
  /** 广告每条积分 */
  unitPoints: positivePoints,
  /** 免费修改次数 */
  freeRevisions: z.int().min(0),
} as const;
const adArgs = z.strictObject({ unitPoints: positivePoints, R: bp });

/** 一条广告：round(单价 × R) */
export const AdPricingSnapshotSchema = z.strictObject({
  ...adCommon,
  kind: z.literal("ad"),
  formula: z.strictObject({ code: z.literal("ad"), args: adArgs }),
  cancelDeductionBp: z.strictObject({ adInProduction: deduction.adInProduction }),
});

/** 一次超出免费次数的修改：即扣即消耗，没有制作中取消，不带取消扣除比例 */
export const AdRevisionPricingSnapshotSchema = z.strictObject({
  ...adCommon,
  kind: z.literal("ad_revision"),
  formula: z.strictObject({ code: z.literal("ad_revision"), args: adArgs }),
});

export const PricingSnapshotSchema = z.discriminatedUnion("kind", [
  DramaPricingSnapshotSchema,
  AdPricingSnapshotSchema,
  AdRevisionPricingSnapshotSchema,
]);
export type PricingSnapshot = z.infer<typeof PricingSnapshotSchema>;
export type DramaPricingSnapshot = z.infer<typeof DramaPricingSnapshotSchema>;
