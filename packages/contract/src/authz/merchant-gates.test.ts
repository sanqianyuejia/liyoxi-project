// 两张名单的自测（任务书 W1-04 第 4 节）：钉住条目；每一条都是路由清单里的商家端接口；本文件是纯常量。
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { importsReachableFrom } from "../__fixtures__/import-scan.js";
import { routeCatalog } from "../routes/index.js";

import {
  CONSENT_WHITELIST_OPERATIONS,
  VERSION_GATE_EXEMPT_OPERATIONS,
  isConsentWhitelisted,
  isVersionGateExempt,
} from "./merchant-gates.js";

const here = dirname(fileURLToPath(import.meta.url));
const byId = new Map(routeCatalog.map((entry) => [entry.operationId, entry]));

describe("商家鉴权链的两张名单", () => {
  it("版本门槛豁免 5 条（约定 C71）、协议同意白名单 9 条（约定 C73）：条目钉住，不重复", () => {
    expect([...VERSION_GATE_EXEMPT_OPERATIONS].sort()).toEqual([
      "m.agreement.list",
      "m.agreementVersion.get",
      "m.analyticsEvent.batchCreate",
      "m.bootstrap.get",
      "m.clientError.create",
    ]);
    expect([...CONSENT_WHITELIST_OPERATIONS].sort()).toEqual([
      "m.agreement.list",
      "m.agreementConsent.create",
      "m.agreementVersion.get",
      "m.analyticsEvent.batchCreate",
      "m.bootstrap.get",
      "m.clientError.create",
      "m.me.deletion.create",
      "m.me.get",
      "m.session.current.delete",
    ]);
    expect(isVersionGateExempt("m.bootstrap.get")).toBe(true);
    expect(isVersionGateExempt("m.me.get")).toBe(false);
    expect(isConsentWhitelisted("m.me.get")).toBe(true);
    expect(isConsentWhitelisted("m.entity.create")).toBe(false);
  });

  it("每一条都在路由清单里，是 V1.0 的商家端接口", () => {
    for (const id of [...VERSION_GATE_EXEMPT_OPERATIONS, ...CONSENT_WHITELIST_OPERATIONS]) {
      const entry = byId.get(id);
      expect(entry, id).toBeDefined();
      expect(entry?.version, id).toBe("V1.0");
      expect(id.startsWith("m."), id).toBe(true);
    }
  });

  it("豁免版本门槛的 5 条都不要求登录；白名单里带登录态的都不要求成员关系", () => {
    for (const id of VERSION_GATE_EXEMPT_OPERATIONS) {
      expect(["public", "optional"], id).toContain(byId.get(id)?.xAuth);
    }
    for (const id of CONSENT_WHITELIST_OPERATIONS) {
      expect(byId.get(id)?.xAuth, id).not.toBe("member");
    }
  });

  it("纯常量：不引任何包", () => {
    expect(importsReachableFrom(join(here, "merchant-gates.ts")).packages).toEqual([]);
  });
});
