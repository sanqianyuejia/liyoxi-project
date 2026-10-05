import { describe, expect, it } from "vitest";

import { PricingSnapshotSchema } from "./pricing-snapshot.js";

const id = (n: number): string => `01960000-0000-7000-8000-00000000000${String(n)}`;
const common = {
  v: 1,
  termId: id(1),
  planId: id(2),
  planRevisionId: id(3),
  planModel: "advanced",
  discountBp: 9000,
  expiredTermRefund: { merchant: "addon", platform: "addon", qualification: "addon" },
  quotedAt: "2026-09-30T02:05:00.000Z",
};
// D1 第 5.3 节的例子
const drama = {
  ...common,
  kind: "drama",
  dramaId: id(4),
  P: 2400,
  priceSource: { mode: "template", tier: "A", dramaPriceRevisionId: null, tierRevisionId: id(5) },
  topModelSelected: false,
  surchargeBp: 0,
  S: 2160,
  formula: { code: "drama", args: { P: 2400, R: 9000, T: 0 } },
  cancelDeductionBp: {
    planConfirm: 1000,
    adAndSample: 3000,
    samplePending: 5000,
    postSample: null,
  },
};
const ad = {
  ...common,
  kind: "ad",
  unitPoints: 50,
  freeRevisions: 2,
  S: 45,
  formula: { code: "ad", args: { unitPoints: 50, R: 9000 } },
  cancelDeductionBp: { adInProduction: 10_000 },
};

describe("冻结单的计价与规则快照（W1-10；07 分组 第 4.5 节）", () => {
  it("三种快照各自合格：订剧、广告、超次修改（不带取消扣除比例）", () => {
    expect(PricingSnapshotSchema.parse(drama)).toEqual(drama);
    expect(PricingSnapshotSchema.parse(ad)).toEqual(ad);
    const { cancelDeductionBp: _dropped, ...rest } = ad;
    const revision = {
      ...rest,
      kind: "ad_revision",
      formula: { code: "ad_revision", args: ad.formula.args },
    };
    expect(PricingSnapshotSchema.parse(revision)).toEqual(revision);
  });

  it("按 kind 只带用得到的键：多一个、少一个、应扣不是正整数都不合格", () => {
    expect(() => PricingSnapshotSchema.parse({ ...ad, surchargeBp: 0 })).toThrow();
    expect(() =>
      PricingSnapshotSchema.parse({ ...drama, cancelDeductionBp: { adInProduction: 10_000 } }),
    ).toThrow();
    expect(() => PricingSnapshotSchema.parse({ ...drama, S: 0 })).toThrow();
    expect(() => PricingSnapshotSchema.parse({ ...drama, S: 2160.5 })).toThrow();
    expect(() => PricingSnapshotSchema.parse({ ...drama, kind: "upgrade" })).toThrow();
    const { expiredTermRefund: _missing, ...noRule } = drama;
    expect(() => PricingSnapshotSchema.parse(noRule)).toThrow();
  });
});
