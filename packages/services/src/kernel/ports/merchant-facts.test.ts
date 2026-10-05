import { describe, expect, it } from "vitest";

import { assembleForTest } from "../../testing/index.js";
import { defineRegistration } from "../assembly/index.js";
import type { Tx } from "../tx.js";
import {
  defaultMerchantFacts,
  implementMerchantFacts,
  MERCHANT_FACT_SOURCES,
  merchantFactsOf,
  merchantFactsPort,
} from "./merchant-facts.js";
import type { MerchantFactsQuery } from "./merchant-facts.js";

// 任务书 W1-03 第 10 节第 3 项：按来源分键；没人登记的键取 0 或 null。不连库：实现都是内存里的样例。

const tx = {} as Tx;
const [storeA, storeB] = [
  "01890000-0000-7000-8000-00000000000a",
  "01890000-0000-7000-8000-00000000000b",
];
const query: MerchantFactsQuery = {
  entityId: "01890000-0000-7000-8000-000000000001",
  storeIds: [storeA, storeB],
  viewerRole: "owner",
  merchantUserId: "01890000-0000-7000-8000-000000000002",
  now: new Date("2026-01-05T04:00:00.000Z"),
};

describe("事实端口", () => {
  it("真实模块的装配里端口已声明；一个键都没登记时，八个键都是默认值", async () => {
    const assembly = assembleForTest({ entry: "api", withoutRealPorts: [merchantFactsPort] });
    expect(assembly.ports.map((item) => item.port.name)).toContain("merchant.facts");
    const reader = merchantFactsOf(assembly);
    expect(MERCHANT_FACT_SOURCES.filter((source) => reader.has(source))).toEqual([]);
    const facts = await reader.read(tx, query);
    expect(facts).toEqual(defaultMerchantFacts(query.storeIds));
    expect(Object.keys(facts).sort()).toEqual([...MERCHANT_FACT_SOURCES].sort());
    expect(facts.billing).toEqual({ subscription: null, wallet: null });
    expect(facts.order.stores[storeB]).toEqual({
      liveCount: 0,
      deliveringCount: 0,
      cartCount: 0,
      todoCount: 0,
    });
    expect(facts.profile.stores[storeA]?.city).toBeNull();
    expect(facts.notify.unreadMessageCount).toBe(0);
  });

  it("登记了的键取实现给的；实现漏掉的门店补默认值；别的键不受影响", async () => {
    const seen: MerchantFactsQuery[] = [];
    const sample = defineRegistration("lyxtest_facts", {
      portImplementations: [
        implementMerchantFacts("order", async (_tx, asked) => {
          seen.push(asked);
          return {
            stores: {
              [storeA]: { liveCount: 2, deliveringCount: 1, cartCount: 3, todoCount: 4 },
            },
          };
        }),
        implementMerchantFacts("billing", async () => ({
          subscription: {
            planName: "专业版",
            endDate: "2026-10-12",
            isActive: true,
            maxStores: 3,
            maxMembers: null,
          },
          wallet: null,
        })),
      ],
    });
    const assembly = assembleForTest({
      entry: "api",
      extra: [sample],
      withoutRealPorts: [merchantFactsPort],
    });
    const reader = merchantFactsOf(assembly);
    expect(reader.has("order")).toBe(true);
    expect(reader.has("profile")).toBe(false);

    const facts = await reader.read(tx, query);
    expect(seen).toEqual([query]);
    expect(facts.order.stores[storeA]?.liveCount).toBe(2);
    expect(facts.order.stores[storeB]).toEqual({
      liveCount: 0,
      deliveringCount: 0,
      cartCount: 0,
      todoCount: 0,
    });
    expect(facts.billing.subscription?.maxStores).toBe(3);
    expect(facts.asset).toEqual(defaultMerchantFacts(query.storeIds).asset);

    // 只问几个键：没问的不调实现，给默认值
    seen.length = 0;
    const partial = await reader.read(tx, query, ["billing"]);
    expect(seen).toEqual([]);
    expect(partial.order).toEqual(defaultMerchantFacts(query.storeIds).order);
    expect((await reader.source(tx, "billing", query)).subscription?.planName).toBe("专业版");
  });
});
