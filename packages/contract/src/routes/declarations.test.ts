// 按 operationId 的两张登记（W0-22b）：限流档位（约定 C68）、三段式用例（约定 C51）。
// 登记的 operationId 写错一个字，api 就会少限一条、少认一条：这里逐个对路由清单。
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  allMetaOnlyRoutes,
  allRoutes,
  isRateLimitTier,
  isThreePhaseRoute,
  RATE_LIMIT_TIER_NAMES,
  RATE_LIMIT_TIERS,
  rateLimitTiersOf,
  ROUTE_GROUPS,
  routeCatalog,
  THREE_PHASE_OPERATIONS,
  THREE_PHASE_SHAPES,
  UnknownRateLimitTierError,
  type RateLimitTierDef,
} from "./index.js";

const tiers: Readonly<Record<string, RateLimitTierDef>> = RATE_LIMIT_TIERS;
const routes = new Map(
  routeCatalog.filter((entry) => !entry.registryKeyOnly).map((entry) => [entry.operationId, entry]),
);
const declared = [...allRoutes, ...allMetaOnlyRoutes];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SHAPE_BY_LABEL: Readonly<Record<string, string>> = {
  先外调: "external-first",
  先落库: "commit-first",
  多事务: "multi-tx",
};

/** 约定 C51 的表：operationId → 形态。一格里写了几个 operationId 的拆成几条 */
function conventionThreePhaseTable(): Record<string, string> {
  const lines = readFileSync(resolve(repoRoot, "docs/api/00-conventions.md"), "utf8").split("\n");
  const start = lines.findIndex((line) => line.startsWith("**C51 "));
  const table: Record<string, string> = {};
  let inTable = false;
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("|")) {
      if (inTable) break;
      continue;
    }
    inTable = true;
    const [first = "", label = ""] = line.split("|").slice(1);
    for (const match of first.matchAll(/`([^`]+)`/g)) {
      table[match[1] ?? ""] = SHAPE_BY_LABEL[label.trim()] ?? label.trim();
    }
  }
  return table;
}

describe("限流档位的登记（约定 C68）", () => {
  it("专用档位名下的 operationId 都在路由清单里，一条路由至多一个专用档位", () => {
    const seen = new Map<string, string>();
    const problems: string[] = [];
    for (const [tier, def] of Object.entries(tiers)) {
      for (const operationId of def.operations) {
        if (!routes.has(operationId)) problems.push(`${tier}：路由清单里没有 ${operationId}`);
        const other = seen.get(operationId);
        if (other !== undefined) problems.push(`${operationId} 同时登记在 ${other} 与 ${tier}`);
        seen.set(operationId, tier);
      }
    }
    expect(problems).toEqual([]);
  });

  it("每一组恰有一个缺省档位；缺省档位不另列 operationId，专用档位不空", () => {
    for (const group of ROUTE_GROUPS) {
      const defaults = Object.entries(tiers).filter(([, def]) => def.defaultFor === group);
      expect(defaults, group).toHaveLength(1);
    }
    for (const [tier, def] of Object.entries(tiers)) {
      if (def.defaultFor === undefined) expect(def.operations.length, tier).toBeGreaterThan(0);
      else expect(def.operations, tier).toEqual([]);
    }
  });

  it("每条路由都有生效档位：专用的在前，所在组的缺省档位在后", () => {
    for (const operationId of routes.keys()) {
      expect(rateLimitTiersOf({ operationId }).length, operationId).toBeGreaterThan(0);
    }
    expect(rateLimitTiersOf({ operationId: "m.order.list" })).toEqual(["m.global"]);
    expect(rateLimitTiersOf({ operationId: "m.session.create" })).toEqual([
      "m.login.silent",
      "m.global",
    ]);
    // 签发类的档位跨组：下载页的三条挂 m.sign，同时受下载页的缺省档位约束
    expect(rateLimitTiersOf({ operationId: "portal.orderItem.downloadUrls" })).toEqual([
      "m.sign",
      "portal.global",
    ]);
    expect(rateLimitTiersOf({ operationId: "admin.auth.login" })).toEqual([
      "admin.login",
      "admin.global",
    ]);
    // 回调只按来源 IP
    expect(rateLimitTiersOf({ operationId: "hooks.wechatpay.transaction.notify" })).toEqual([
      "hooks.ip",
    ]);
  });

  it("路由自己写的 x-rate-limit 另加一档；写了没登记的档位即报错", () => {
    expect(rateLimitTiersOf({ operationId: "m.order.list", "x-rate-limit": "m.sign" })).toEqual([
      "m.sign",
      "m.global",
    ]);
    expect(rateLimitTiersOf({ operationId: "m.order.list", "x-rate-limit": "m.global" })).toEqual([
      "m.global",
    ]);
    expect(() =>
      rateLimitTiersOf({ operationId: "m.order.list", "x-rate-limit": "m.nope" }),
    ).toThrow(UnknownRateLimitTierError);
    expect(RATE_LIMIT_TIER_NAMES.every(isRateLimitTier)).toBe(true);
    expect(isRateLimitTier("toString")).toBe(false);
  });

  it("契约里已登记的路由写了 x-rate-limit 的，档位都登记过", () => {
    const unknown = declared
      .filter((route) => route["x-rate-limit"] !== undefined)
      .filter((route) => !isRateLimitTier(route["x-rate-limit"]))
      .map((route) => `${route.operationId}：${String(route["x-rate-limit"])}`);
    expect(unknown).toEqual([]);
  });
});

describe("三段式用例的登记（约定 C51）", () => {
  it("登记的 operationId 都在路由清单里，都是写路由，形态在三种之内", () => {
    const problems: string[] = [];
    for (const [operationId, shape] of Object.entries(THREE_PHASE_OPERATIONS)) {
      const route = routes.get(operationId);
      if (route === undefined) problems.push(`路由清单里没有 ${operationId}`);
      else if (route.method === "GET") problems.push(`${operationId} 是读路由`);
      if (!THREE_PHASE_SHAPES.includes(shape))
        problems.push(`${operationId} 的形态 ${shape} 不认得`);
    }
    expect(problems).toEqual([]);
  });

  it("与约定 C51 的表逐条一致：不多、不少，形态相同", () => {
    const table = conventionThreePhaseTable();
    expect(Object.keys(table).length).toBeGreaterThan(0);
    expect({ ...THREE_PHASE_OPERATIONS }).toEqual(table);
  });

  it("登记表与路由上的 x-three-phase 两处都认；路由上标了的都在登记表里", () => {
    expect(isThreePhaseRoute({ operationId: "m.paymentOrder.wechatPrepay" })).toBe(true);
    expect(isThreePhaseRoute({ operationId: "m.order.list" })).toBe(false);
    expect(isThreePhaseRoute({ operationId: "m.order.list", "x-three-phase": true })).toBe(true);
    const unregistered = declared
      .filter((route) => route["x-three-phase"] === true)
      .filter((route) => !Object.hasOwn(THREE_PHASE_OPERATIONS, route.operationId))
      .map((route) => route.operationId);
    expect(unregistered).toEqual([]);
  });
});
