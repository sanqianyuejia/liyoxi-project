import { describe, expect, it } from "vitest";

import { EVENT_PAYLOAD_SCHEMAS } from "../events/index.js";
import {
  billingOrderContentSchema,
  fulfillResultSchema,
  SUBSCRIPTION_EVENT_PAYLOADS,
} from "./fulfill.js";

// 履约一侧的契约（W1-11a）：付款单内容快照、履约结果、订阅事件细节，与履约发的三个出站事件。
const ID = "0199a0b0-0000-7000-8000-000000000001";
const OTHER = "0199a0b0-0000-7000-8000-000000000002";
const AT = "2026-01-05T04:00:00.000Z";

const PLAN = {
  v: 1,
  kind: "plan",
  planId: ID,
  planRevisionId: OTHER,
  months: 3,
  cyclePriceFen: 1_800_000,
  payFen: 1_800_000,
  monthlyPoints: 6600,
  discountBp: 9000,
  promo: null,
  quotedAt: AT,
} as const;

describe("付款单内容快照与履约结果（W1-11a）", () => {
  it("内容快照按 kind 三种形态；套餐的月数、应付、每月积分都大于 0；多一个键不过", () => {
    expect(billingOrderContentSchema.parse(PLAN)).toEqual(PLAN);
    const promo = { claimRevisionId: ID, type: "previous_revision", appliedRevisionId: OTHER };
    expect(billingOrderContentSchema.safeParse({ ...PLAN, promo }).success).toBe(true);
    for (const patch of [{ months: 0 }, { payFen: 0 }, { monthlyPoints: 0 }, { memo: "x" }]) {
      expect(billingOrderContentSchema.safeParse({ ...PLAN, ...patch }).success).toBe(false);
    }
    const topup = { v: 1, kind: "topup", packId: ID, points: 1000, payFen: 100_000 };
    expect(billingOrderContentSchema.parse(topup)).toEqual(topup);
    expect(billingOrderContentSchema.safeParse({ v: 1, kind: "gift" }).success).toBe(false);
  });

  it("履约结果：done 带生效时刻、周期、批次、标注；blocked 带原因码与排查信息", () => {
    const done = {
      status: "done",
      effectiveAt: AT,
      termId: ID,
      lotIds: [OTHER],
      queuedBehindActive: false,
      notes: ["promo_already_claimed"],
    };
    expect(fulfillResultSchema.parse(done)).toEqual(done);
    expect(fulfillResultSchema.safeParse({ ...done, notes: ["随手写的"] }).success).toBe(false);
    const blocked = {
      status: "blocked",
      reasonCode: "CONSTRAINT_VIOLATION",
      detail: { termIds: [ID] },
    };
    expect(fulfillResultSchema.parse(blocked)).toEqual(blocked);
    expect(fulfillResultSchema.safeParse({ ...blocked, reasonCode: "WHATEVER" }).success).toBe(
      false,
    );
  });

  it("订阅事件细节：续接带名额，开通与续费预约没有细节", () => {
    const rolled = { maxStores: 3, maxMembers: null };
    expect(SUBSCRIPTION_EVENT_PAYLOADS.rolled_over.parse(rolled)).toEqual(rolled);
    expect(SUBSCRIPTION_EVENT_PAYLOADS.activated.parse(null)).toBeNull();
    expect(SUBSCRIPTION_EVENT_PAYLOADS.renewal_scheduled.safeParse({}).success).toBe(false);
  });

  it("履约发的三个事件各有 schema：开通六个键齐全，时刻要带毫秒，多一个键不过", () => {
    const good = {
      "billing.subscription.activated": {
        v: 1,
        termId: ID,
        entityId: OTHER,
        planId: ID,
        startsAt: AT,
        endsAt: "2026-02-04T16:00:00.000Z",
        sourceBillingOrderId: OTHER,
      },
      "billing.subscription.renewal_scheduled": {
        v: 1,
        termId: ID,
        entityId: OTHER,
        startsAt: AT,
        endsAt: "2026-02-04T16:00:00.000Z",
      },
      "billing.order_fulfilled": {
        v: 1,
        billingOrderId: ID,
        entityId: OTHER,
        contentType: "plan_new",
        termId: ID,
      },
    } as const;
    for (const [name, payload] of Object.entries(good)) {
      const schema = EVENT_PAYLOAD_SCHEMAS[name as keyof typeof good];
      expect(schema.parse(payload), name).toEqual(payload);
      expect(schema.safeParse({ ...payload, note: "自由文本" }).success, name).toBe(false);
    }
    const activated = EVENT_PAYLOAD_SCHEMAS["billing.subscription.activated"];
    const { planId: _planId, ...missing } = good["billing.subscription.activated"];
    expect(activated.safeParse(missing).success).toBe(false);
    expect(
      activated.safeParse({ ...good["billing.subscription.activated"], startsAt: "2026-01-05" })
        .success,
    ).toBe(false);
    expect(
      EVENT_PAYLOAD_SCHEMAS["billing.order_fulfilled"].safeParse({
        ...good["billing.order_fulfilled"],
        termId: null,
      }).success,
    ).toBe(true);
  });
});
