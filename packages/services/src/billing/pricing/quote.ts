// 应扣积分与计价快照（W1-10）：取 P、R、T，交给 @liyoxi/shared/pricing 的报价函数算，拼成 PricingSnapshot。
// 依据：07 分组 第 4.5、5.1 节；D1 第 5.1–5.4 节；03 第 2.5 节；任务书 第 10 节第 1 项。
// 冻结在账户锁内按账本时钟调它；报价接口（不落库）传注入时钟的现在调的是同一个函数，所以两边不会算出两个数。
// 取数：P = 剧目积分价 priceAt(at)；R、制作模型 = 当前生效周期行上的权益快照；T、广告单价、取消扣除比例、
// 退回去向 = paramsAt(at)。三者用同一个时刻。取整只在 shared 里，这里不做乘除。
import { PricingSnapshotSchema } from "@liyoxi/contract";
import type { PricingSnapshot } from "@liyoxi/contract";
import { quoteAd, quoteDramaItem } from "@liyoxi/shared/pricing";

import { LedgerError } from "../ledger/types.js";
import type { Db } from "../ledger/types.js";
import { paramsAt, priceAt } from "./index.js";

/** 冻结的计价入参（m04 第 3.15 节副作用第 3 步）：订剧只给剧目与是否选用顶级模型，等级与价格由 billing 自己读 */
export type HoldPricing =
  | { readonly kind: "drama"; readonly dramaId: string; readonly topModel: boolean }
  | { readonly kind: "ad" }
  | { readonly kind: "ad_revision" };

/** 计价要读的周期列：折扣与制作模型取周期行上的权益快照，升级后立刻变 */
export interface QuoteTerm {
  readonly id: string;
  readonly planId: string;
  readonly planRevisionId: string;
  readonly discountBp: number;
  readonly productionModel: string;
}

/**
 * 时刻 at、在周期 term 下，这一笔应扣多少积分，连同计价与规则快照。
 * 订剧取不到积分价（没有热度等级又没有生效的单剧修订、该等级没有模板价、没有这部剧）抛 LedgerError("price_unavailable")：
 * 可订的剧不该这样，订购侧在此之前已经过 content 的可订校验。
 */
export async function quoteHold(
  db: Db,
  term: QuoteTerm,
  pricing: HoldPricing,
  at: Date,
): Promise<PricingSnapshot> {
  const params = await paramsAt(db, at);
  const common = {
    v: 1,
    termId: term.id,
    planId: term.planId,
    planRevisionId: term.planRevisionId,
    planModel: term.productionModel,
    discountBp: term.discountBp,
    expiredTermRefund: params.expiredTermRefund,
    quotedAt: at.toISOString(),
  };
  let draft: Record<string, unknown>;
  if (pricing.kind === "drama") {
    const price = (await priceAt(db, [pricing.dramaId], at)).get(pricing.dramaId);
    if (price === undefined || typeof price === "string") {
      throw new LedgerError("price_unavailable", "取不到剧目积分价", {
        dramaId: pricing.dramaId,
        reason: price ?? "not_found",
      });
    }
    const quote = quoteDramaItem({
      listPricePoints: price.points,
      discountBp: term.discountBp,
      topModelSurchargeBp: params.topModelSurchargeBp,
      isTopModelSelected: pricing.topModel,
      isTopModelIncluded: term.productionModel === "top",
    });
    const { planConfirm, adAndSample, samplePending, postSample } = params.cancelDeductionBp;
    draft = {
      ...common,
      kind: "drama",
      dramaId: pricing.dramaId,
      P: price.points,
      priceSource: price.source,
      topModelSelected: pricing.topModel,
      surchargeBp: quote.surchargeBp,
      S: quote.chargePoints,
      formula: {
        code: "drama",
        args: { P: price.points, R: term.discountBp, T: quote.surchargeBp },
      },
      cancelDeductionBp: { planConfirm, adAndSample, samplePending, postSample },
    };
  } else {
    draft = {
      ...common,
      kind: pricing.kind,
      unitPoints: params.adUnitPoints,
      freeRevisions: params.adFreeRevisions,
      S: quoteAd(params.adUnitPoints, term.discountBp),
      formula: {
        code: pricing.kind,
        args: { unitPoints: params.adUnitPoints, R: term.discountBp },
      },
      // 超次修改即扣即消耗，没有制作中取消，不带扣除比例
      ...(pricing.kind === "ad"
        ? { cancelDeductionBp: { adInProduction: params.cancelDeductionBp.adInProduction } }
        : {}),
    };
  }
  const parsed = PricingSnapshotSchema.safeParse(draft);
  if (!parsed.success) {
    // 应扣为 0（积分价或折扣为 0）、周期行上的值不在枚举里：都是数据异常
    throw new LedgerError("guard", "计价结果不合快照的结构", {
      kind: pricing.kind,
      S: draft["S"],
      issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    });
  }
  return parsed.data;
}
