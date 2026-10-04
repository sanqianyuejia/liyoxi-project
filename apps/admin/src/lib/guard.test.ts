import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { FORBIDDEN_PATH, judgePath, requireModule } from "./guard";
import type { AccessSnapshot } from "./permissions";

const finance: AccessSnapshot = {
  staff: { id: "s3", name: "吴敏", roleKey: "finance", roleName: "财务" },
  isLead: false,
  moduleLevels: { workbench: "v", finance: "e", order: "v" },
  actions: [],
  dataScope: "all",
  releases: {},
};

describe("路由守卫", () => {
  it("模块等级不够：抛出去 403 页的重定向", () => {
    expect(() => requireModule(finance, "finance", "e")).not.toThrow();
    expect(() => requireModule(finance, "order")).not.toThrow();
    let thrown: unknown;
    try {
      requireModule(finance, "system");
    } catch (error) {
      thrown = error;
    }
    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to: string } }).options.to).toBe(FORBIDDEN_PATH);
    expect(() => requireModule(finance, "order", "e")).toThrow();
    expect(() => requireModule(null, "workbench")).toThrow();
  });

  it("按登记表判地址：能进、不能进、没登记", () => {
    expect(judgePath(finance, "/finance/refunds")).toBe("ok");
    expect(judgePath(finance, "/sys/staff")).toBe("forbidden");
    // V1.1 的页面开关没开：直接访问地址同样进不去
    expect(judgePath(finance, "/finance/settle")).toBe("forbidden");
    expect(judgePath(finance, "/no/such/page")).toBe("not-found");
  });
});
