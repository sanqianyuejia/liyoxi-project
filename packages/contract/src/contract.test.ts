// 契约自测（任务书 W0-08 第 7 节第 1–6 条）。段落标题里的“验收 N”对应任务书的验收编号。
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
// 包自己的子路径，按使用方的写法引：exports 配错了这里过不了类型检查
import type { CommonErrorSymbol as SubpathErrorSymbol } from "@liyoxi/contract/errors";
import type { components as AdminComponents } from "@liyoxi/contract/types/admin";
import type { components as MerchantComponents } from "@liyoxi/contract/types/merchant";
import type { components as PortalComponents } from "@liyoxi/contract/types/portal";

import { GENERATED_DIR, generate, renderGenerated } from "../scripts/generate.js";
import * as fixtures from "./__fixtures__/routes.js";
import { importsReachableFrom } from "./__fixtures__/import-scan.js";
import * as contract from "./index.js";
import {
  COMMON_ERRORS,
  COMMON_ERROR_DETAILS,
  COMMON_ERROR_SYMBOLS,
  ContractRouteError,
  HTTP_STATUSES,
  READ_IDEMPOTENT_REASON,
  adminRoute,
  allRegistryOnly,
  allRoutes,
  defineRouteRegistry,
  findUnregisteredRoutes,
  hookRoute,
  merchantRoute,
  okResponse,
  portalRoute,
  registryOnly,
  routeRegistry,
  z,
  type CommonErrorDetails,
  type CommonErrorSymbol,
  type DictRef,
  type ErrorBody,
} from "./index.js";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageDir, "../..");

type Node = Record<string, unknown>;
const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 深度优先走一遍文档里的每个对象节点 */
function walk(value: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (!isNode(value)) return;
  visit(value);
  for (const child of Object.values(value)) walk(child, visit);
}

const allowsNull = (schema: unknown) =>
  isNode(schema) && Array.isArray(schema.type) && schema.type.includes("null");

describe("验收 2：通用错误码与登记表对账", () => {
  /** docs/api/registry-errors.md 第 1 节的表：符号、数值、HTTP、可重试 */
  function registryRows() {
    const text = readFileSync(join(repoRoot, "docs/api/registry-errors.md"), "utf8");
    const section = text.slice(text.indexOf("\n## 1. "), text.indexOf("\n## 2. "));
    return section
      .split("\n")
      .map((line) => /^\| `([A-Z_]+)` \| (\d+) \| (\d+) \| (是|否|—) \|/.exec(line))
      .filter((match) => match !== null)
      .map((match) => ({
        symbol: match[1],
        code: Number(match[2]),
        http: Number(match[3]),
        // “—”取 false（任务书 W0-08 第 11 节第 3 项）
        retryable: match[4] === "是",
      }));
  }

  it("28 行，符号、数值、HTTP、可重试 0 差异，行序一致", () => {
    const rows = registryRows();
    expect(rows).toHaveLength(28);
    const ours = COMMON_ERROR_SYMBOLS.map((symbol) => ({
      symbol,
      code: COMMON_ERRORS[symbol].code,
      http: COMMON_ERRORS[symbol].http,
      retryable: COMMON_ERRORS[symbol].retryable,
    }));
    expect(ours).toEqual(rows);
  });

  it("符号与数值各自不重复；数值五位；HTTP 在约定 C24 之内；默认文案不为空", () => {
    const rows = registryRows();
    expect(new Set(rows.map((row) => row.symbol)).size).toBe(28);
    expect(new Set(rows.map((row) => row.code)).size).toBe(28);
    const defs = Object.values(COMMON_ERRORS);
    expect(new Set(defs.map((item) => item.code)).size).toBe(28);
    for (const [symbol, item] of Object.entries(COMMON_ERRORS)) {
      expect(symbol).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(String(item.code)).toMatch(/^\d{5}$/);
      expect(HTTP_STATUSES).toContain(item.http);
      expect(item.message.trim().length, symbol).toBeGreaterThan(0);
    }
  });

  it("可重试为真的只有约定 C26 列的六个", () => {
    const retryable = COMMON_ERROR_SYMBOLS.filter((symbol) => COMMON_ERRORS[symbol].retryable);
    expect(retryable.sort()).toEqual([
      "BUSY",
      "IDEMPOTENCY_IN_PROGRESS",
      "MAINTENANCE",
      "PROVIDER_UNAVAILABLE",
      "RATE_LIMITED",
      "UPSTREAM_TIMEOUT",
    ]);
  });

  it("带 details 的码：纯常量一侧与 Zod 一侧的符号、类型一致", () => {
    const flagged = COMMON_ERROR_SYMBOLS.filter((symbol) => COMMON_ERRORS[symbol].hasDetails);
    expect(flagged.sort()).toEqual(["CONSENT_REQUIRED", "REMINDED_TODAY"]);
    expect(Object.keys(COMMON_ERROR_DETAILS).sort()).toEqual(flagged);
    type Inferred = {
      [K in keyof typeof COMMON_ERROR_DETAILS]: z.infer<(typeof COMMON_ERROR_DETAILS)[K]>;
    };
    expectTypeOf<Inferred>().toEqualTypeOf<CommonErrorDetails>();
    expect(
      COMMON_ERROR_DETAILS.REMINDED_TODAY.safeParse({
        scene: "confirm_plan",
        nextAvailableDate: "2026-10-05",
      }).success,
    ).toBe(true);
    const consent = { pendingConsents: [{ agreementKey: "user", name: "《用户协议》" }] };
    expect(COMMON_ERROR_DETAILS.CONSENT_REQUIRED.parse(consent)).toEqual(consent);
  });
});

describe("验收 3：样例路由进三份文档", () => {
  let outDir: string;
  const docs: Record<string, Node> = {};
  const types: Record<string, string> = {};

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), "lyx-contract-"));
    await generate({ outDir, routes: fixtures.sampleRegistry.routes });
    for (const name of ["merchant", "admin", "portal"]) {
      docs[name] = JSON.parse(readFileSync(join(outDir, `${name}.openapi.json`), "utf8")) as Node;
      types[name] = readFileSync(join(outDir, `${name}.d.ts`), "utf8");
    }
  });
  afterAll(() => rmSync(outDir, { recursive: true, force: true }));

  const operationsOf = (doc: Node) =>
    Object.entries(doc.paths as Record<string, Record<string, Node>>).flatMap(([path, item]) =>
      Object.entries(item).map(([method, operation]) => ({ path, method, operation })),
    );

  it("三份文档各含且只含自己那一条", () => {
    const summary = Object.fromEntries(
      Object.entries(docs).map(([name, doc]) => [
        name,
        operationsOf(doc).map(
          (item) => `${item.method} ${item.path} ${String(item.operation.operationId)}`,
        ),
      ]),
    );
    expect(summary).toEqual({
      merchant: ["patch /api/v1/m/fixture-things/{fixtureThingId} m.fixtureThing.update"],
      admin: ["get /api/v1/admin/fixture-things admin.fixtureThing.list"],
      portal: ["get /api/v1/portal/fixture-things portal.fixtureThing.list"],
    });
  });

  it("回调与探活不出现在任何一份里", () => {
    // 文档自带一个顶层键 webhooks，所以按“路径段、operationId 前缀、探活名”来认
    const leaked = /\/hooks\/|hooks\.[a-z]|healthz/;
    for (const name of Object.keys(docs)) {
      const text = readFileSync(join(outDir, `${name}.openapi.json`), "utf8");
      expect(leaked.test(text), `${name}.openapi.json`).toBe(false);
      expect(leaked.test(types[name]!), `${name}.d.ts`).toBe(false);
    }
    expect(readdirSync(outDir).sort()).toEqual([
      "admin.d.ts",
      "admin.openapi.json",
      "merchant.d.ts",
      "merchant.openapi.json",
      "portal.d.ts",
      "portal.openapi.json",
    ]);
  });

  it("路径参数必填且不可为 null", () => {
    const seen: string[] = [];
    const bad: string[] = [];
    walk(Object.values(docs), (node) => {
      if (node.in !== "path") return;
      seen.push(String(node.name));
      if (node.required !== true || allowsNull(node.schema)) bad.push(String(node.name));
    });
    expect(seen).toEqual(["fixtureThingId"]);
    expect(bad).toEqual([]);
  });

  it("数组里引用的组件不登记成可空", () => {
    for (const doc of Object.values(docs)) {
      const schemas = (doc.components as { schemas: Record<string, unknown> }).schemas;
      const nullable = new Set(
        Object.entries(schemas)
          .filter(([, schema]) => allowsNull(schema))
          .map(([name]) => `#/components/schemas/${name}`),
      );
      const bad: string[] = [];
      walk(doc, (node) => {
        if (node.type !== "array" || !isNode(node.items)) return;
        const ref = node.items.$ref;
        if (typeof ref === "string" && nullable.has(ref)) bad.push(ref);
      });
      expect(bad).toEqual([]);
    }
  });

  it("每份文档都登记了通用结构与错误体；错误响应指向 ErrorBody", () => {
    for (const [name, doc] of Object.entries(docs)) {
      const schemas = (doc.components as { schemas: Record<string, unknown> }).schemas;
      expect(Object.keys(schemas), name).toEqual(
        expect.arrayContaining(["DictRef", "ErrorBody", "SentryEnvelope", "FixtureThing"]),
      );
    }
    const [update] = operationsOf(docs.merchant!);
    const responses = update!.operation.responses as Record<string, Node>;
    expect(Object.keys(responses)).toEqual(["200", "400", "404", "409"]);
    expect(JSON.stringify(responses["404"])).toContain("#/components/schemas/ErrorBody");
  });

  it("元数据进了文档：缺省值已补，值为 null 的键不出", () => {
    const [update] = operationsOf(docs.merchant!);
    expect(update!.operation).toMatchObject({
      "x-auth": "member",
      "x-capability": "fixture.manage",
      "x-clerk-view": "none",
      "x-idempotent": "required",
    });
    const [list] = operationsOf(docs.admin!);
    expect(list!.operation).toMatchObject({
      "x-auth": "staff",
      "x-idempotent": "none",
      "x-idempotent-reason": READ_IDEMPOTENT_REASON,
    });
    expect(list!.operation).not.toHaveProperty("x-permission");
    const [cursorList] = operationsOf(docs.portal!);
    expect(cursorList!.operation).toMatchObject({ "x-auth": "portal" });
    expect(cursorList!.operation).not.toHaveProperty("x-capability");
  });

  it("x-open-enum 生成“已知值 | (string & {})”；占位值不进文档（约定 C37）", () => {
    const thing = (docs.admin!.components as { schemas: Record<string, Node> }).schemas
      .FixtureThing!;
    expect((thing.properties as Record<string, Node>).status).toEqual({
      enum: ["draft", "live"],
      type: "string",
      "x-open-enum": true,
    });
    for (const name of Object.keys(docs)) {
      expect(types[name]).toContain('status: "draft" | "live" | (string & {});');
      expect(types[name]).toContain('previousStatus: ("draft" | "live" | (string & {})) | null;');
      expect(types[name]).not.toContain("__lyx_open_enum__");
      expect(JSON.stringify(docs[name])).not.toContain("__lyx_open_enum__");
    }
  });

  it("输出稳定：两次生成字节相同，键有序，结尾换行", async () => {
    const first = await renderGenerated(fixtures.sampleRegistry.routes);
    const reversed = [...fixtures.sampleRegistry.routes].reverse();
    const second = await renderGenerated(reversed);
    expect([...second]).toEqual([...first]);
    for (const [name, content] of first) {
      expect(content.endsWith("\n"), name).toBe(true);
      expect(content, name).toBe(readFileSync(join(outDir, name), "utf8"));
    }
    walk(Object.values(docs), (node) => {
      const keys = Object.keys(node);
      expect(keys).toEqual([...keys].sort());
    });
  });

  it("样例路由能挂到 OpenAPIHono 上，入参按契约校验", async () => {
    const id = "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b";
    const app = new OpenAPIHono().openapi(fixtures.sampleMerchantRoute, (c) => {
      const { fixtureThingId } = c.req.valid("param");
      const { priceFen } = c.req.valid("json");
      return c.json(
        {
          code: 0 as const,
          message: "ok" as const,
          data: {
            id: fixtureThingId,
            status: "live" as const,
            previousStatus: null,
            category: null,
            tags: [],
            priceFen,
            createdAt: new Date(0).toISOString(),
          },
        },
        200,
      );
    });
    const call = (path: string, body: unknown) =>
      app.request(path, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const okResult = await call(`/api/v1/m/fixture-things/${id}`, { priceFen: 990, extra: 1 });
    expect(okResult.status).toBe(200);
    expect(await okResult.json()).toMatchObject({ code: 0, data: { id, priceFen: 990 } });
    expect((await call("/api/v1/m/fixture-things/1024", { priceFen: 990 })).status).toBe(400);
    expect((await call(`/api/v1/m/fixture-things/${id}`, { priceFen: 9.9 })).status).toBe(400);
  });
});

describe("提交的生成物（任务书 W0-08 第 11 节第 1 项）", () => {
  // 下面这一条钉的是 M0 骨架的现状，不是长期的黄金条目，后面的包要按新的现状替换它：
  //   - W0-10 登记第一批路由时，改 allRoutes、allRegistryOnly 与“paths 为空”三处；
  //   - 各域第一个后端 PR 加具名结构时，改组件清单（现在只有 DictRef、ErrorBody、SentryEnvelope）。
  // 这两处是预期替换，不算“删改已有黄金条目”。替换时把断言换成新的现状（条数、组件名），不要整条删掉。
  it("登记表里没有真实路由：三份文档 paths 为空，但都有通用结构与错误体", async () => {
    expect(allRoutes).toEqual([]);
    expect(allRegistryOnly).toEqual([]);
    for (const name of ["merchant", "admin", "portal"]) {
      const doc = JSON.parse(
        readFileSync(join(GENERATED_DIR, `${name}.openapi.json`), "utf8"),
      ) as Node;
      expect(doc.openapi).toBe("3.1.0");
      expect(doc.paths).toEqual({});
      expect(Object.keys((doc.components as { schemas: Node }).schemas)).toEqual([
        "DictRef",
        "ErrorBody",
        "SentryEnvelope",
      ]);
    }
  });

  it("与源码一致：文件清单与内容逐字节相同（过期就跑 pnpm contract:generate）", async () => {
    const fresh = await renderGenerated();
    expect(readdirSync(GENERATED_DIR).sort()).toEqual([...fresh.keys()].sort());
    for (const [name, content] of fresh) {
      expect(readFileSync(join(GENERATED_DIR, name), "utf8"), name).toBe(content);
    }
  });

  it("都已交给 git：已跟踪的文件清单与现生成的一致（新增了生成物就 git add）", async () => {
    // pnpm contract:check 用 git diff，看不见未跟踪的文件；它又会先把文件生成出来，
    // 所以同一个检出里先跑它、再跑上一条用例，上一条也看不出“新增的生成物忘了提交”。
    // 这里直接问 git 的索引，与两步的先后无关。需要在 git 检出里跑（contract:check 同样需要）。
    const tracked = execFileSync("git", ["ls-files", "--", "generated"], {
      cwd: packageDir,
      encoding: "utf8",
    });
    const fresh = await renderGenerated();
    expect(tracked.split("\n").filter(Boolean).sort()).toEqual(
      [...fresh.keys()].map((name) => `generated/${name}`).sort(),
    );
  });

  it("生成的类型与 Zod 结构同形", () => {
    expectTypeOf<MerchantComponents["schemas"]["DictRef"]>().toEqualTypeOf<DictRef>();
    expectTypeOf<AdminComponents["schemas"]["DictRef"]>().toEqualTypeOf<DictRef>();
    expectTypeOf<PortalComponents["schemas"]["ErrorBody"]>().toEqualTypeOf<ErrorBody>();
    expectTypeOf<SubpathErrorSymbol>().toEqualTypeOf<CommonErrorSymbol>();
  });
});

describe("验收 4：构造器把关", () => {
  const responses = okResponse(z.null());
  const problemsOf = (build: () => unknown): string => {
    try {
      build();
    } catch (error) {
      expect(error).toBeInstanceOf(ContractRouteError);
      return (error as ContractRouteError).problems.join("\n");
    }
    throw new Error("本该抛错，却构造成功了");
  };
  /** 一条还没声明幂等方式的商家端写路由；各用例在它上面加减字段 */
  const write = {
    method: "post",
    path: "/m/fixture-things",
    operationId: "m.fixtureThing.create",
    "x-clerk-view": "none",
    responses,
  } as const;
  const created = { 201: { description: "约定不用 201" } };
  const fixtureHook = {
    method: "post",
    path: "/hooks/fixture/events",
    operationId: "hooks.fixture.event.receive",
    "x-idempotent": "natural",
    "x-idempotent-by": ["uq_fixture"],
    responses: { 200: { description: "按 Provider 协议应答" } },
  } as const;

  it("写路由缺 x-idempotent", () => {
    // @ts-expect-error 写路由必须显式声明幂等方式
    expect(problemsOf(() => merchantRoute(write))).toMatch(/写路由须声明 x-idempotent/);
  });

  it("natural 缺 x-idempotent-by", () => {
    const missing = { ...write, "x-idempotent": "natural" } as const;
    // @ts-expect-error natural 须同时写出约束名
    expect(problemsOf(() => merchantRoute(missing))).toMatch(/natural 须同时写出 x-idempotent-by/);
    const empty = { ...missing, "x-idempotent-by": [] } as const;
    // @ts-expect-error 约束名数组不能为空
    expect(problemsOf(() => merchantRoute(empty))).toMatch(/natural 须同时写出 x-idempotent-by/);
  });

  it("none 缺 x-idempotent-reason", () => {
    const missing = { ...write, "x-idempotent": "none" } as const;
    // @ts-expect-error none 须写理由
    expect(problemsOf(() => merchantRoute(missing))).toMatch(/none 须写理由/);
    const blank = { ...missing, "x-idempotent-reason": "  " } as const;
    expect(problemsOf(() => merchantRoute(blank))).toMatch(/none 须写理由/);
  });

  it("后台路由缺 x-permission；写 null 表示不设权限点，可以", () => {
    const admin = {
      method: "post",
      path: "/admin/fixture-things",
      operationId: "admin.fixtureThing.create",
      "x-idempotent": "required",
      responses,
    } as const;
    // @ts-expect-error adminRoute 的 x-permission 必填
    expect(problemsOf(() => adminRoute(admin))).toMatch(/后台路由须声明 x-permission/);
    expect(adminRoute({ ...admin, "x-permission": null })["x-permission"]).toBeNull();
    expect(adminRoute({ ...admin, "x-permission": "assert-in-handler" })["x-permission"]).toBe(
      "assert-in-handler",
    );
    expect(problemsOf(() => adminRoute({ ...admin, "x-permission": "" }))).toMatch(
      /x-permission 须为非空字符串或 null/,
    );
  });

  it("operationId 不合约定 C14", () => {
    const build = (operationId: string) =>
      problemsOf(() => merchantRoute({ ...write, "x-idempotent": "required", operationId }));
    for (const bad of [
      "m.FixtureThing.create", // 资源段不是小驼峰
      "m.fixture-thing.create", // 带短横线
      "m.create", // 少一段
      "m.a.b.c.d", // 多一段
      "merchant.fixtureThing.create", // 组名不对
    ]) {
      expect(build(bad), bad).toMatch(/不合约定 C14/);
    }
    expect(build("admin.fixtureThing.create")).toMatch(/第一段须为 m/);
  });

  it("operationId 重复：登记时报错", () => {
    const one = merchantRoute({ ...write, "x-idempotent": "required" });
    const other = merchantRoute({
      ...write,
      path: "/m/fixture-others",
      "x-idempotent": "required",
    });
    expect(problemsOf(() => defineRouteRegistry({ routes: [one, other] }))).toMatch(
      /operationId 或登记键重复：m\.fixtureThing\.create/,
    );
    const probe = registryOnly({ registryKey: "hooks.healthz.get", path: "/healthz" });
    expect(
      problemsOf(() => defineRouteRegistry({ routes: [one], registryOnly: [probe, probe] })),
    ).toMatch(/登记键重复：hooks\.healthz\.get/);
  });

  it("同一个“方法 + 路径”登记两次：登记时报错", () => {
    const one = merchantRoute({ ...write, "x-idempotent": "required" });
    const other = merchantRoute({
      ...write,
      operationId: "m.fixtureThing.batchCreate",
      "x-idempotent": "required",
    });
    expect(problemsOf(() => defineRouteRegistry({ routes: [one, other] }))).toMatch(
      /方法与路径重复：post \/api\/v1\/m\/fixture-things/,
    );
  });

  it("绕开构造器直接写的路由进不了登记表", () => {
    const raw = createRoute({ method: "get", path: "/api/v1/m/raw", responses });
    expect(problemsOf(() => defineRouteRegistry({ routes: [raw as never] }))).toMatch(
      /不是由 merchantRoute/,
    );
  });

  it("缺省值：商家端 member、后台 staff、回调 signed；GET 固定 none 并带理由", () => {
    const read = merchantRoute({
      method: "get",
      path: "/m/fixture-things",
      operationId: "m.fixtureThing.list",
      "x-clerk-view": "same",
      responses,
    });
    expect(read).toMatchObject({
      path: "/api/v1/m/fixture-things",
      "x-auth": "member",
      "x-capability": null,
      "x-idempotent": "none",
      "x-idempotent-reason": READ_IDEMPOTENT_REASON,
    });
    expect(read.getRoutingPath()).toBe("/api/v1/m/fixture-things");
    expect(fixtures.sampleAdminRoute["x-auth"]).toBe("staff");
    expect(fixtures.sampleHookRoute["x-auth"]).toBe("signed");
    expect(Object.isFrozen(read)).toBe(true);
  });

  const m = { ...write, "x-idempotent": "required" } as const;

  it("路径、状态码、路径参数不合约定", () => {
    const cases: Array<[string, () => unknown, RegExp]> = [
      ["路径不在本组", () => merchantRoute({ ...m, path: "/admin/things" }), /须以 \/m\/ 开头/],
      ["路径带 /api/v1", () => merchantRoute({ ...m, path: "/api/v1/m/a" }), /须以 \/m\/ 开头/],
      ["路径段写成驼峰", () => merchantRoute({ ...m, path: "/m/fixtureThings" }), /短横线小写/],
      ["用了 201", () => merchantRoute({ ...m, responses: created }), /201/],
      ["路径参数没声明", () => merchantRoute({ ...m, path: "/m/things/{thingId}" }), /路径参数/],
    ];
    for (const [name, build, pattern] of cases) expect(problemsOf(build), name).toMatch(pattern);
  });

  it("x-auth、x-clerk-view、x-permission 用错了组", () => {
    const { "x-clerk-view": _clerkView, ...noClerkView } = m;
    // @ts-expect-error 商家端须声明 x-clerk-view
    expect(problemsOf(() => merchantRoute(noClerkView))).toMatch(/须声明 x-clerk-view/);
    const staffInMerchant = { ...m, "x-auth": "staff" } as const;
    // @ts-expect-error staff 只在后台
    expect(problemsOf(() => merchantRoute(staffInMerchant))).toMatch(/x-auth 须为/);
    const permissionInMerchant = { ...m, "x-permission": "fixture.manage" } as const;
    expect(problemsOf(() => merchantRoute(permissionInMerchant))).toMatch(/只用于后台/);
    const portal = { ...noClerkView, path: "/portal/a", operationId: "portal.a.create" } as const;
    // @ts-expect-error 下载页的 x-auth 没有缺省，须显式声明
    expect(problemsOf(() => portalRoute(portal))).toMatch(/x-auth 须为/);
    const publicHook = { ...fixtureHook, "x-auth": "public" } as const;
    expect(problemsOf(() => hookRoute(publicHook))).toMatch(/x-auth 须为 signed/);
    const skipWithoutPermission = {
      ...noClerkView,
      path: "/admin/fixture-things/reject",
      operationId: "admin.fixtureThing.reject",
      "x-permission": null,
      "x-step-up": "skip",
    } as const;
    expect(problemsOf(() => adminRoute(skipWithoutPermission))).toMatch(/须有权限点/);
  });

  it("幂等声明互相矛盾", () => {
    const readAsRequired = { ...m, method: "get" } as const;
    // @ts-expect-error GET 的幂等方式只能是 none
    expect(problemsOf(() => merchantRoute(readAsRequired))).toMatch(/GET 不写库/);
    const byOnRequired = { ...m, "x-idempotent-by": ["uq_fixture"] } as const;
    expect(problemsOf(() => merchantRoute(byOnRequired))).toMatch(/只用于 x-idempotent: natural/);
    const redactOnNone = {
      ...write,
      "x-idempotent": "none",
      "x-idempotent-reason": "签发短时地址",
      "x-redact-on-replay": ["url"],
    } as const;
    expect(problemsOf(() => merchantRoute(redactOnNone))).toMatch(/只用于 x-idempotent: required/);
  });

  it("只登记的条目只收探活", () => {
    expect(
      problemsOf(() => registryOnly({ registryKey: "hooks.ping.get", path: "/ping" })),
    ).toMatch(/只登记的条目只有探活/);
    expect(problemsOf(() => registryOnly({ registryKey: "healthz", path: "/healthz" }))).toMatch(
      /登记键/,
    );
    const internal = registryOnly({
      registryKey: "hooks.internalHealth.flow.get",
      path: "/internal/health/flow",
    });
    expect(internal).toMatchObject({ registryKeyOnly: true, method: "get", internalOnly: true });
    expect(fixtures.sampleProbe.internalOnly).toBe(false);
  });
});

describe("验收 5：导出的路由都已登记", () => {
  it("干净的包：返回空", () => {
    expect(findUnregisteredRoutes(contract, routeRegistry)).toEqual([]);
  });

  it("导出了却没登记的夹具：返回该路由名", () => {
    expect(findUnregisteredRoutes(fixtures, fixtures.sampleRegistry)).toEqual(["orphanRoute"]);
  });

  it("只登记的条目同样要进登记表", () => {
    const withoutProbe = defineRouteRegistry({ routes: fixtures.sampleRegistry.routes });
    expect(findUnregisteredRoutes(fixtures, withoutProbe)).toEqual(["orphanRoute", "sampleProbe"]);
  });
});

describe("验收 6：纯常量子路径不带 Zod", () => {
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
    exports: Record<string, { types: string; default?: string }>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  it("./errors 可达的源文件没有任何包的 import（zod、@hono/zod-openapi、hono 都到不了）", () => {
    const target = manifest.exports["./errors"]!;
    expect(target.default).toBe("./src/errors/index.ts");
    expect(target.types).toBe(target.default);
    const scan = importsReachableFrom(join(packageDir, target.default!));
    expect(scan.files.map((file) => file.slice(packageDir.length + 1)).sort()).toEqual([
      "src/errors/common.ts",
      "src/errors/index.ts",
      "src/errors/types.ts",
    ]);
    expect(scan.packages).toEqual([]);
    // 参数不是字面量的动态 import 扫描跟不过去：纯常量子路径里一处都不许有
    expect(scan.unresolved).toEqual([]);
  });

  it("反例：经一层转手、只在类型上引 zod，也扫得出来", () => {
    const scan = importsReachableFrom(join(packageDir, "src/__fixtures__/reach-zod/entry.ts"));
    // zod/mini 是模板字符串写的动态 import（import(`zod/mini`)），hono 是引号写的
    expect(scan.packages).toEqual(["@hono/zod-openapi", "hono", "zod", "zod/mini"]);
    expect(scan.unresolved.map((item) => item.slice(packageDir.length + 1))).toEqual([
      "src/__fixtures__/reach-zod/leaf.ts: import(name);",
    ]);
    const fromRoot = importsReachableFrom(join(packageDir, "src/index.ts"));
    expect(fromRoot.packages).toContain("@hono/zod-openapi");
    expect(fromRoot.unresolved).toEqual([]);
  });

  it("src/zod.ts 直接 import zod：依赖方向检查靠这一行看见 Zod", () => {
    // weapp-no-zod、shared-no-zod 按“能不能走到 zod”来拦，而 @hono/zod-openapi 解析到它的 dist/，
    // 被该检查的排除项滤掉（状态文件 W0-08 偏差 6）。所以这行直接 import 不能删，
    // 也不能改成只经 @hono/zod-openapi 拿 z：那样小程序与 shared 引包入口时门禁看不见。
    const scan = importsReachableFrom(join(packageDir, "src/zod.ts"));
    expect(scan.files.map((file) => file.slice(packageDir.length + 1))).toEqual(["src/zod.ts"]);
    expect(scan.packages).toEqual(["@hono/zod-openapi", "zod"]);
  });

  it("./types/* 只给类型，指向生成的声明文件；声明文件不引任何模块", () => {
    for (const name of ["merchant", "admin", "portal"]) {
      expect(manifest.exports[`./types/${name}`]).toEqual({ types: `./generated/${name}.d.ts` });
      const text = readFileSync(join(GENERATED_DIR, `${name}.d.ts`), "utf8");
      expect(text).not.toMatch(/^\s*import\s/m);
      expect(text).not.toMatch(/\bfrom\s+["']/);
    }
  });

  it("exports 只开任务书定的子路径（W0-08 的五个；W0-09a 加的纯常量子路径各有自己的用例）", () => {
    expect(Object.keys(manifest.exports)).toEqual([
      ".",
      "./errors",
      "./enums",
      "./registry",
      "./types/merchant",
      "./types/admin",
      "./types/portal",
    ]);
  });

  it("contract 不依赖任何工作区包（验收 9）", () => {
    const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    expect(names.filter((name) => name.startsWith("@liyoxi/"))).toEqual([]);
  });
});
