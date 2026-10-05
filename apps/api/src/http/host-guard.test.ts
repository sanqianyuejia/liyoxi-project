// Host 判断的口径（约定 C1；任务书 W0-22 第 10 节第 5 项）。不连库。
import { describe, expect, it } from "vitest";

import { hostAllows, surfaceOf } from "./host-guard.js";

const M = "/api/v1/m/orders";
const HOOKS = "/api/v1/hooks/wechatpay/transactions";
const ADMIN = "/api/v1/admin/staff";
const PORTAL = "/api/v1/portal/portal-tickets";

describe("surfaceOf", () => {
  it("只看域名的第一段；预发的 api.stg.<域名> 同样认得", () => {
    expect(surfaceOf("api.liyoxi.timavia.com")).toBe("api");
    expect(surfaceOf("API.stg.liyoxi.timavia.com:443")).toBe("api");
    expect(surfaceOf("admin.liyoxi.timavia.com")).toBe("admin");
    expect(surfaceOf("portal.stg.liyoxi.timavia.com")).toBe("portal");
  });

  it("节点内网地址、localhost、单段主机名、没有 Host：都不算公网域名", () => {
    for (const host of ["10.0.3.7:3000", "localhost:3000", "api", "api:3000", "[::1]:3000", ""]) {
      expect(surfaceOf(host)).toBeNull();
    }
    expect(surfaceOf(undefined)).toBeNull();
  });
});

describe("hostAllows", () => {
  it.each([
    ["api.liyoxi.timavia.com", [M, HOOKS, "/healthz", "/readyz", "/health"], [ADMIN, PORTAL]],
    ["admin.liyoxi.timavia.com", [ADMIN], [M, HOOKS, PORTAL, "/healthz", "/health"]],
    ["portal.liyoxi.timavia.com", [PORTAL], [M, HOOKS, ADMIN, "/readyz"]],
  ])("%s 只放行自己的分组", (host, allowed, denied) => {
    for (const path of allowed) expect(hostAllows(host, path, "prod"), path).toBe(true);
    for (const path of denied) expect(hostAllows(host, path, "prod"), path).toBe(false);
  });

  it("/internal/* 只在不是公网域名时放行", () => {
    const path = "/internal/health/finance";
    expect(hostAllows("10.0.3.7:3000", path, "prod")).toBe(true);
    for (const host of ["api.liyoxi.timavia.com", "admin.liyoxi.timavia.com", "portal.x.com"]) {
      expect(hostAllows(host, path, "prod")).toBe(false);
    }
  });

  it("不是公网域名：探活总放行；各组只在 local、test 下放行", () => {
    for (const env of ["local", "test", "stg", "prod"] as const) {
      expect(hostAllows("10.0.3.7:3000", "/readyz", env)).toBe(true);
    }
    for (const path of [M, HOOKS, ADMIN, PORTAL]) {
      expect(hostAllows("localhost:3000", path, "local")).toBe(true);
      expect(hostAllows(undefined, path, "test")).toBe(true);
      expect(hostAllows("10.0.3.7:3000", path, "stg")).toBe(false);
      expect(hostAllows("10.0.3.7:3000", path, "prod")).toBe(false);
    }
  });

  it("不在任何一组之内的路径不归它管（落到 404）", () => {
    expect(hostAllows("admin.liyoxi.timavia.com", "/api/v1/unknown/x", "prod")).toBe(true);
    expect(hostAllows("api.liyoxi.timavia.com", "/favicon.ico", "prod")).toBe(true);
  });
});
