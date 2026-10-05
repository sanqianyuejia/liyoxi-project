// 接口侧注册表对账的自测（任务书 W0-09b 第 7 节第 1–10 条）。对账的逻辑在 scripts/api-registries-check.ts，
// 这里一是拿真实的登记数据跑它（pnpm test 也能看见漂移），二是拿改坏的数据、改坏的文档试它报不报得出来。
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { SOURCE_PATHS } from "../scripts/api-registries-check.js";
import {
  CONTRACT_SNAPSHOT,
  apiRegistryProblems,
  countsOf,
  loadSources,
  parseA09Scenes,
  parseCodeRanges,
  parseD6Events,
  parseErrorsDoc,
  parsePermissionsDoc,
  parseSeededScenes,
  type ApiRegistrySnapshot,
  type ApiRegistrySources,
  type PermissionsJson,
} from "../scripts/api-registries-check.js";

import * as contract from "./index.js";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageDir, "../..");
const sources = loadSources();

/** 拿一份改过的契约数据去对账 */
const withSnapshot = (change: (snapshot: ApiRegistrySnapshot) => Partial<ApiRegistrySnapshot>) =>
  apiRegistryProblems({ ...CONTRACT_SNAPSHOT, ...change(CONTRACT_SNAPSHOT) }, sources);
/** 拿一份改过的文档去对账 */
const withText = (
  key: keyof typeof SOURCE_PATHS,
  change: (text: string) => string,
): (() => string[]) => {
  const changed = change(sources.texts[key]);
  expect(changed, `${key} 没改到`).not.toBe(sources.texts[key]);
  return () =>
    apiRegistryProblems(CONTRACT_SNAPSHOT, {
      ...sources,
      texts: { ...sources.texts, [key]: changed },
    });
};
const replaceItem = <T>(list: readonly T[], match: (item: T) => boolean, next: (item: T) => T) => {
  expect(list.filter(match), "要改的那一项应恰好一个").toHaveLength(1);
  return list.map((item) => (match(item) ? next(item) : item));
};

describe("真实数据：契约与文档 0 差异", () => {
  it("各张登记表对账通过", () => {
    expect(apiRegistryProblems(CONTRACT_SNAPSHOT, sources)).toEqual([]);
  });

  it("文档的表格都读到了内容（不是因为什么都没读到才没有差异）", () => {
    const errors = parseErrorsDoc(sources.texts.errorsDoc);
    expect(errors.common.length).toBeGreaterThan(20);
    expect(errors.domain.length).toBeGreaterThan(200);
    expect(errors.domain.filter((item) => item.hasDetails).length).toBeGreaterThan(100);
    expect(new Set(errors.domain.map((item) => item.source)).size).toBeGreaterThan(15);
    const authz = parsePermissionsDoc(sources.texts.permissionsDoc);
    expect(authz.permissions.length).toBeGreaterThan(100);
    expect(authz.sectionCounts.size).toBe(contract.PERMISSION_SECTIONS.length);
    expect(authz.capabilities.length).toBeGreaterThan(30);
    expect(Object.keys(parseCodeRanges(sources.texts.rulings)).length).toBeGreaterThan(15);
    expect(parseA09Scenes(sources.texts.a09).length).toBeGreaterThan(60);
    const seeded = parseSeededScenes(sources.texts.notifyGroup);
    expect(seeded.filter((item) => item.name === null).length).toBeGreaterThan(30);
    expect(seeded.filter((item) => item.name !== null).length).toBeGreaterThan(30);
    expect(parseD6Events(sources.texts.d6).length).toBeGreaterThan(20);
    const counts = countsOf();
    expect(counts.domainErrors).toBe(errors.declared.domain);
    expect(counts.permissionsV10).toBe(authz.declaredV10);
    expect(counts.capabilities).toBe(authz.declaredCapabilities);
    expect(counts.clientPrdEvents + counts.outboxEvents + counts.directEvents).toBe(
      counts.prdEvents,
    );
  });

  it("gen_permissions.py 的产物在的话，另与它比一遍（不入库，CI 里没有就只比登记文档）", () => {
    const path = join(repoRoot, "tools/api-check/out/permissions.json");
    if (!existsSync(path)) return;
    const withJson = loadSources({ permissionsJsonPath: path });
    expect(withJson.permissionsJson?.permissions.length).toBeGreaterThan(100);
    expect(apiRegistryProblems(CONTRACT_SNAPSHOT, withJson)).toEqual([]);
  });
});

describe("改坏契约的数据：报得出来", () => {
  it("领域错误码：少一个、数值、HTTP、可重试、details、定义方", () => {
    const without = withSnapshot((snapshot) => ({
      domainErrors: snapshot.domainErrors.filter((item) => item.symbol !== "POINTS_INSUFFICIENT"),
    }));
    expect(without).toContain("领域错误码：frag有而契约没有：POINTS_INSUFFICIENT");
    expect(without).toContain("领域错误码：登记文档有而契约没有：POINTS_INSUFFICIENT");
    expect(without.some((problem) => problem.startsWith("数量：领域错误码对不上"))).toBe(true);

    const change = (patch: Partial<ApiRegistrySnapshot["domainErrors"][number]>) =>
      withSnapshot((snapshot) => ({
        domainErrors: replaceItem(
          snapshot.domainErrors,
          (item) => item.symbol === "QUOTE_CHANGED",
          (item) => ({ ...item, ...patch }),
        ),
      }));
    expect(change({ code: 43099 })).toEqual([
      "领域错误码 QUOTE_CHANGED 的数值：契约是 43099，frag是 43007",
      "领域错误码 QUOTE_CHANGED 的数值：契约是 43099，登记文档是 43007",
    ]);
    expect(change({ http: 400 })).toContain(
      "领域错误码 QUOTE_CHANGED 的HTTP：契约是 400，登记文档是 409",
    );
    expect(change({ retryable: true })).toContain(
      "领域错误码 QUOTE_CHANGED 的可重试：契约是 是，frag是 否",
    );
    expect(change({ hasDetails: false })).toContain(
      "领域错误码 QUOTE_CHANGED 的是否带 details：契约是 否，登记文档是 是",
    );
    const moved = change({ source: "m01-account" });
    expect(moved).toContain(
      "领域错误码 QUOTE_CHANGED 的定义方：契约是 m01-account，frag是 m07-billing",
    );
    expect(moved.some((problem) => problem.includes("不在定义方 m01-account 的取号区间内"))).toBe(
      true,
    );
  });

  it("错误码：符号与通用码重名、数值撞号、取号区间与裁决不符", () => {
    const first = CONTRACT_SNAPSHOT.domainErrors[0]!;
    const clash = withSnapshot((snapshot) => ({
      domainErrors: [
        ...snapshot.domainErrors,
        { ...first, symbol: "RATE_LIMITED" },
        { ...first, symbol: "LYX_SELFTEST_ONLY" },
      ],
    }));
    expect(clash).toContain("错误码的符号重复登记：RATE_LIMITED");
    expect(clash).toContain(`错误码的数值重复：${first.code}`);
    const ranges = withSnapshot((snapshot) => ({
      errorRanges: { ...snapshot.errorRanges, "m06-ad": [[45200, 45399]] },
    }));
    expect(ranges).toEqual([
      "错误码的取号区间 m06-ad 的区间：契约是 45200–45399，裁决 A70是 45200–45299",
    ]);
  });

  it("通用错误码也在对账之内", () => {
    const problems = withSnapshot((snapshot) => ({
      commonErrors: replaceItem(
        snapshot.commonErrors,
        (item) => item.symbol === "NOT_FOUND",
        (item) => ({ ...item, http: 410 }),
      ),
    }));
    expect(problems).toEqual(["通用错误码 NOT_FOUND 的HTTP：契约是 410，登记文档是 404"]);
  });

  it("权限点：少一个、名称、小节、默认授予、再验证、待分配池、起始版本", () => {
    const without = withSnapshot((snapshot) => ({
      permissions: snapshot.permissions.filter((item) => item.key !== "sys.role.edit"),
    }));
    expect(without).toContain("权限点：登记文档有而契约没有：sys.role.edit");
    expect(without.some((problem) => problem.startsWith("数量：权限点“系统设置”一节对不上"))).toBe(
      true,
    );
    expect(without.some((problem) => problem.startsWith("数量：V1.0 的权限点对不上"))).toBe(true);

    const change = (patch: Partial<ApiRegistrySnapshot["permissions"][number]>) =>
      withSnapshot((snapshot) => ({
        permissions: replaceItem(
          snapshot.permissions,
          (item) => item.key === "merchant.manager.assign",
          (item) => ({ ...item, ...patch }),
        ),
      }));
    expect(change({ name: "分配交付经理" })).toEqual([
      "权限点 merchant.manager.assign 的名称：契约是 分配交付经理，登记文档是 首次分配交付经理",
    ]);
    expect(
      change({ grant: { kind: "roles", roles: [{ role: "delivery_manager", leadOnly: false }] } }),
    ).toEqual(["权限点 merchant.manager.assign 的默认授予：契约是 交付经理，登记文档是 交付经理*"]);
    expect(change({ grant: { kind: "super_admin_only" } })).toEqual([
      "权限点 merchant.manager.assign 的默认授予：契约是 仅超级管理员，登记文档是 交付经理*",
    ]);
    expect(change({ stepUp: true })).toEqual([
      "权限点 merchant.manager.assign 的再验证：契约是 要，登记文档是 否",
    ]);
    expect(change({ pool: null })).toEqual([
      "权限点 merchant.manager.assign 的待分配池：契约是 —，登记文档是 store_manager",
    ]);
    expect(change({ since: "v1.1" })).toContain(
      "权限点 merchant.manager.assign 的起始版本：契约是 V1.1，登记文档是 V1.0",
    );
    expect(change({ section: "order" })).toContain(
      "权限点 merchant.manager.assign 的小节：契约是 订单管理，登记文档是 商家管理",
    );
  });

  it("能力点：少一个、含义、店员、已停用门店的老板", () => {
    expect(
      withSnapshot((snapshot) => ({
        capabilities: snapshot.capabilities.filter((item) => item.key !== "me.*"),
      })),
    ).toContain("能力点：登记文档有而契约没有：me.*");
    const change = (patch: Partial<ApiRegistrySnapshot["capabilities"][number]>) =>
      withSnapshot((snapshot) => ({
        capabilities: replaceItem(
          snapshot.capabilities,
          (item) => item.key === "plan.purchase",
          (item) => ({ ...item, ...patch }),
        ),
      }));
    expect(change({ clerk: { allowed: true, limit: null } })).toEqual([
      "能力点 plan.purchase 的店员：契约是 ✔，登记文档是 ✘",
    ]);
    expect(change({ archivedOwner: { allowed: true, limit: null } })).toEqual([
      "能力点 plan.purchase 的已停用门店的老板：契约是 ✔，登记文档是 ✔（主体级）",
    ]);
    expect(change({ name: "买套餐" })).toEqual([
      "能力点 plan.purchase 的含义：契约是 买套餐，登记文档是 购买与续费套餐",
    ]);
  });

  it("模块键的顺序与名称", () => {
    const reversed = withSnapshot((snapshot) => ({ modules: [...snapshot.modules].reverse() }));
    expect(reversed.some((problem) => problem.startsWith("模块键：契约是 channel、system"))).toBe(
      true,
    );
    expect(
      reversed.some((problem) => problem.startsWith("模块名称：契约是 渠道管理、系统设置")),
    ).toBe(true);
  });

  it("资源登记：少一个、参数名、别名、表", () => {
    const without = withSnapshot((snapshot) => ({
      resources: snapshot.resources.filter((item) => item.resource !== "payment-orders"),
    }));
    expect(without).toContain("资源：resources.json有而契约没有：payment-orders");
    const change = (patch: Partial<ApiRegistrySnapshot["resources"][number]>) =>
      withSnapshot((snapshot) => ({
        resources: replaceItem(
          snapshot.resources,
          (item) => item.resource === "merchant-users",
          (item) => ({ ...item, ...patch }),
        ),
      }));
    expect(change({ param: "userId" })).toEqual([
      "资源 merchant-users 的参数名：契约是 userId，resources.json是 merchantUserId",
    ]);
    expect(change({ aliases: [] })).toEqual([
      "资源 merchant-users 的别名：契约是 （无），resources.json是 /m/me",
    ]);
    expect(change({ surfaces: ["m"] })).toEqual([
      "资源 merchant-users 的端：契约是 m，resources.json是 m、admin",
    ]);
    const sameTable = change({ table: "staff" });
    expect(sameTable).toContain(
      "资源 merchant-users 的表：契约是 staff，resources.json是 merchant_user",
    );
    expect(sameTable).toContain("资源对应的表重复登记：staff");
  });

  it("通知场景：少一个、显示名、受众", () => {
    const without = withSnapshot((snapshot) => ({
      scenes: snapshot.scenes.filter((item) => item.key !== "m.plan_activated"),
    }));
    expect(without).toEqual([
      "通知场景：a09 第 2.9 节有而契约没有：m.plan_activated",
      "通知场景：frag有而契约没有：m.plan_activated",
      "通知场景：13 分组 第 2.1 节有而契约没有：m.plan_activated",
    ]);
    const change = (key: string, patch: Partial<ApiRegistrySnapshot["scenes"][number]>) =>
      withSnapshot((snapshot) => ({
        scenes: replaceItem(
          snapshot.scenes,
          (item) => item.key === key,
          (item) => ({ ...item, ...patch }),
        ),
      }));
    // 补登的场景三处都有显示名或受众可比；播种的 32 个在 13 分组里只列了键
    expect(change("m.plan_activated", { name: "套餐开通" })).toEqual([
      "通知场景 m.plan_activated 的显示名：契约是 套餐开通，a09 第 2.9 节是 套餐已开通",
      "通知场景 m.plan_activated 的显示名：契约是 套餐开通，13 分组 第 2.1 节是 套餐已开通",
    ]);
    expect(change("m.pay_success", { name: "支付成功" })).toEqual([
      "通知场景 m.pay_success 的显示名：契约是 支付成功，a09 第 2.9 节是 付款成功",
    ]);
    expect(change("m.pay_success", { audience: "staff" })).toHaveLength(3);
  });

  it("订阅点位：多一个、少一个", () => {
    expect(
      withSnapshot((snapshot) => ({
        subscribePoints: snapshot.subscribePoints.filter((key) => key !== "ad_confirm"),
      })),
    ).toEqual([
      "订阅点位：m08 第 4 节 SubscribePoint有而契约没有：ad_confirm",
      "订阅点位：D6 第 2.9.3 节有而契约没有：ad_confirm",
    ]);
    expect(
      withSnapshot((snapshot) => ({ subscribePoints: [...snapshot.subscribePoints, "cart_add"] })),
    ).toHaveLength(2);
  });

  it("埋点事件：来源、端上事件清单、扩展事件", () => {
    const change = (name: string, patch: Partial<ApiRegistrySnapshot["events"][number]>) =>
      withSnapshot((snapshot) => ({
        events: replaceItem(
          snapshot.events,
          (item) => item.name === name,
          (item) => ({ ...item, ...patch }),
        ),
      }));
    expect(change("order_submit", { source: "direct" })).toEqual([
      "埋点事件（PRD 的） order_submit 的来源：契约是 direct，D6 第 5.1.1 节是 outbox",
    ]);
    expect(change("order_submit", { source: "client" })).toContain(
      "端上上报的埋点事件：契约有而m08 第 4 节 ClientEventName没有：order_submit",
    );
    const demoted = change("banner_click", { extension: false });
    expect(demoted).toContain("埋点事件（PRD 的）：契约有而D6 第 5.1.1 节没有：banner_click");
    expect(demoted).toContain("埋点事件（扩展的）：14 分组 第 3 节有而契约没有：banner_click");
    expect(demoted.some((problem) => problem.startsWith("数量：PRD 的埋点事件对不上"))).toBe(true);
  });

  it("07 第 7 节的待回写项：键没登记、开关的值类型与默认值不符", () => {
    expect(
      withSnapshot((snapshot) => ({
        paramKeys: snapshot.paramKeys.filter((key) => key !== "ad.duration_options"),
      })),
    ).toEqual(["待回写项：07 第 7 节的参数键 ad.duration_options 还没有登记进契约的参数键清单"]);
    expect(
      withSnapshot((snapshot) => ({
        flags: snapshot.flags.filter((item) => item.key !== "ops.maintenance_notice"),
      })),
    ).toEqual(["待回写项：07 第 7 节的开关键 ops.maintenance_notice 还没有登记进契约的开关登记"]);
    const changed = withSnapshot((snapshot) => ({
      flags: replaceItem(
        snapshot.flags,
        (item) => item.key === "admin.wecom_web_login.enabled",
        (item) => ({ ...item, defaultValue: true, exposedTo: "server" as const }),
      ),
    }));
    expect(changed).toEqual([
      "待回写项：开关 admin.wecom_web_login.enabled 的下发范围：契约是 server，07 第 7 节是 client",
      "待回写项：开关 admin.wecom_web_login.enabled 的默认值：契约是 true，07 第 7 节是“默认关”",
    ]);
  });
});

describe("改坏文档：同样报得出来", () => {
  it("登记文档的标题里改了个数，或表格少了一行", () => {
    const heading = withText("errorsDoc", (text) =>
      text.replace(
        /^(## 2\. 领域错误码（)(\d+)/m,
        (_, head: string, n: string) => `${head}${Number(n) + 1}`,
      ),
    )();
    expect(heading).toHaveLength(1);
    expect(heading[0]).toMatch(
      /^数量：领域错误码对不上：登记文档标题 \d+，登记文档表格 \d+，frag \d+，契约 \d+$/,
    );

    const dropped = withText("permissionsDoc", (text) =>
      text
        .split("\n")
        .filter((line) => !line.startsWith("| `drama.shelf` |"))
        .join("\n"),
    )();
    expect(dropped).toContain("权限点：契约有而登记文档没有：drama.shelf");
    expect(
      dropped.some((problem) => problem.startsWith("数量：权限点“短剧库管理”一节对不上")),
    ).toBe(true);
  });

  it("frag 改了一个码的定义，登记文档没跟着重新生成", () => {
    const frags: ApiRegistrySources["frags"] = {
      ...sources.frags,
      "m06-ad": {
        errorCodes: sources.frags["m06-ad"]!.errorCodes!.map((item) =>
          item.symbol === "AD_NOT_VIEWED" ? { ...item, http: 400 } : item,
        ),
      },
    };
    expect(apiRegistryProblems(CONTRACT_SNAPSHOT, { ...sources, frags })).toEqual([
      "领域错误码 AD_NOT_VIEWED 的HTTP：契约是 409，frag是 400",
    ]);
  });

  it("permissions.json 与契约不符", () => {
    const generated: PermissionsJson = {
      permissions: CONTRACT_SNAPSHOT.permissions.slice(0, 1).map((item) => ({
        module: "商家管理",
        key: item.key,
        name: item.name,
        grant: "财务（D2 确认）",
        stepUp: "要（驳回豁免，C86）",
        pool: "—",
        version: "V1.0",
      })),
      capabilities: [],
    };
    const problems = apiRegistryProblems(CONTRACT_SNAPSHOT, {
      ...sources,
      permissionsJson: generated,
    });
    expect(problems).toContain(
      "权限点 merchant.profile.proxy_edit 的默认授予：契约是 客服、交付经理，permissions.json是 财务",
    );
    expect(problems).toContain(
      "权限点 merchant.profile.proxy_edit 的再验证：契约是 否，permissions.json是 要",
    );
    expect(
      problems.some((problem) => problem.startsWith("权限点：契约有而permissions.json没有")),
    ).toBe(true);
  });

  it("文档的表格认不出来：抛错，不当成“没有差异”", () => {
    expect(withText("a09", (text) => text.replace("### 2.9 ", "### 2.9a "))).toThrow(
      /a09 第 2\.9 节/,
    );
    expect(
      withText("errorsDoc", (text) =>
        text.replace(/^## 2\. 领域错误码（\d+ 个/m, "## 2. 领域错误码（若干"),
      ),
    ).toThrow(/标题里没有写个数/);
    expect(
      withText("m08", (text) => text.replace("| `SubscribePoint` |", "| `SubscribePoints` |")),
    ).toThrow(/找不到 SubscribePoint 一行/);
    expect(
      withText("d6", (text) => text.replace("| `cart_add` | 直记 |", "| `cart_add` | 手记 |")),
    ).toThrow(/来源不认识/);
  });
});

describe("包入口（带 Zod 的那一个）", () => {
  it("各子模块的名字都给出来了，没有因为重名被吞掉", async () => {
    // export * 遇到两个模块导出同名的东西时不报错，而是两个都不给：逐个模块核对它的名字都在入口里
    const modules = [
      ...readFileSync(join(packageDir, "src/index.ts"), "utf8").matchAll(
        /^export \* from "(\.\/[^"]+)\.js";$/gm,
      ),
    ].map((match) => match[1]!);
    expect(modules).toContain("./authz/index");
    expect(modules).toContain("./notify/index");
    const exported = new Set(Object.keys(contract));
    const seen = new Map<string, string>();
    for (const module of modules) {
      const names = Object.keys((await import(`${module}.js`)) as Record<string, unknown>);
      expect(names.length, module).toBeGreaterThan(0);
      for (const name of names) {
        expect(seen.get(name), `${name} 在 ${module} 与另一个模块里重名`).toBeUndefined();
        expect(exported.has(name), `${module} 的 ${name} 不在包入口里`).toBe(true);
        seen.set(name, module);
      }
    }
  });
});
