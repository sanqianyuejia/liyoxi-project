// 能力点矩阵（任务书 W1-04 第 7 节验收 5）：契约登记的每个键 × 老板、店员、已停用门店的老板，逐格与登记一致。
import { CAPABILITIES } from "@liyoxi/contract/authz";
import { describe, expect, it } from "vitest";

import { AppError, createIdentityContext } from "../../kernel/index.js";
import {
  assertCapability,
  entityScopeOf,
  hasCapability,
  MERCHANT_STANDINGS,
  ScopeError,
  standingOf,
  storeScopeOf,
} from "./index.js";

const symbolOf = (run: () => void): string | null => {
  try {
    run();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).error;
  }
};

describe("能力点矩阵", () => {
  it("每个键 × 三种身份，逐格与契约的登记一致；没有的回对应的码", () => {
    expect(CAPABILITIES.length).toBeGreaterThan(30);
    for (const capability of CAPABILITIES) {
      for (const standing of MERCHANT_STANDINGS) {
        const allowed = capability[standing].allowed;
        expect(hasCapability(standing, capability.key), `${capability.key} × ${standing}`).toBe(
          allowed,
        );
        const denied = standing === "archivedOwner" ? "STORE_ARCHIVED" : "ROLE_FORBIDDEN";
        expect(
          symbolOf(() => assertCapability(standing, capability.key)),
          `${capability.key} × ${standing}`,
        ).toBe(allowed ? null : denied);
      }
    }
  });

  it("组键是单个键，不是通配；没登记的键一律没有", () => {
    expect(hasCapability("clerk", "me.*")).toBe(true);
    expect(hasCapability("clerk", "me.update")).toBe(false);
    expect(hasCapability("owner", "cart.*")).toBe(true);
    expect(hasCapability("owner", "cart.add")).toBe(false);
    expect(hasCapability("owner", "lyxtest.nope")).toBe(false);
    expect(hasCapability("owner", "toString")).toBe(false);
  });

  it("角色 × 门店状态落到矩阵的哪一列", () => {
    expect(standingOf("owner", "active")).toBe("owner");
    expect(standingOf("owner", "archived")).toBe("archivedOwner");
    expect(standingOf("clerk", "active")).toBe("clerk");
    // 收尾上下文：能恢复门店、看订单，不能下单
    expect(hasCapability("archivedOwner", "store.restore")).toBe(true);
    expect(symbolOf(() => assertCapability("archivedOwner", "order.create"))).toBe(
      "STORE_ARCHIVED",
    );
    expect(symbolOf(() => assertCapability("clerk", "order.create"))).toBe("ROLE_FORBIDDEN");
  });
});

describe("数据范围", () => {
  const actor = {
    type: "merchant" as const,
    id: "018f0000-0000-7000-8000-000000000001",
    client: "weapp" as const,
    role: "owner" as const,
  };
  const entityId = "018f0000-0000-7000-8000-0000000000e1";
  const storeId = "018f0000-0000-7000-8000-0000000000a1";

  it("有门店的上下文给得出两种范围；范围是冻结的", () => {
    const ctx = createIdentityContext({ actor, entityId, storeId });
    const store = storeScopeOf(ctx);
    expect(store).toEqual({ entityId, storeId });
    expect(Object.isFrozen(store)).toBe(true);
    expect(entityScopeOf(ctx)).toEqual({ entityId });
  });

  it("没有归属的上下文取范围即抛：是代码缺陷，不回给用户", () => {
    const anonymous = createIdentityContext({ actor });
    expect(() => storeScopeOf(anonymous)).toThrow(ScopeError);
    expect(() => entityScopeOf(anonymous)).toThrow(ScopeError);
    expect(() => storeScopeOf(createIdentityContext({ actor, entityId }))).toThrow(ScopeError);
  });
});
