// 装配顺序只在一处定义（任务书 W0-22b 第 7 节第 4 条；硬性规则 28；约定 C7）：
// 链的先后由 PIPELINE_ORDER 定，与登记在第几行无关；登记表写错了建应用即失败；别处不另挂中间件。
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { uuidv7 } from "@liyoxi/services";
import { describe, expect, it } from "vitest";

import { MountError, pipelineProblems } from "../src/routing/mount.js";
import { PIPELINE_ORDER, ROUTE_MIDDLEWARES } from "../src/routing/pipeline.js";
import type { PipelineEntry, PipelineSlot } from "../src/routing/pipeline.js";
import { fakeAuth, stubMiddleware, useTestApi } from "../src/testing/index.js";

import { adminListHandler, hookReceiveHandler, SAMPLE_HANDLERS } from "./fixtures.js";

const testApi = useTestApi();
const TIMEOUT = { timeout: 60_000 };

const userId = uuidv7();
const auth = fakeAuth({ actor: { type: "merchant", id: userId, client: "weapp", role: "owner" } });

/** 记下自己被执行的中间件：占一个槽位，把槽位名写进回包头 */
const tracer = (slot: PipelineSlot, groups?: PipelineEntry["groups"]): PipelineEntry => ({
  slot,
  ...(groups === undefined ? {} : { groups }),
  factory: () => async (c, next) => {
    await next();
    c.res.headers.set("x-trace", [slot, c.res.headers.get("x-trace")].filter(Boolean).join(","));
  },
});

describe("链的先后", () => {
  it("登记的次序倒着写，每条路由的链仍按 PIPELINE_ORDER 排，执行也按它", TIMEOUT, async () => {
    const reversed = [...PIPELINE_ORDER]
      .reverse()
      .filter((slot) => !["auth", "rateLimit", "idempotency"].includes(slot))
      .map((slot) => tracer(slot));
    const { api, request } = await testApi.start({
      handlers: SAMPLE_HANDLERS,
      middlewares: [...reversed, auth],
    });
    for (const route of api.mounted) expect(route.middlewares).toEqual([...PIPELINE_ORDER]);

    const response = await request(`/api/v1/m/lyxtest-things/${uuidv7()}`);
    expect(response.status).toBe(200);
    // 回包头是在回程上写的：先执行的写在前面
    expect(response.headers.get("x-trace")).toBe(
      PIPELINE_ORDER.filter((slot) => !["auth", "rateLimit", "idempotency"].includes(slot)).join(
        ",",
      ),
    );
  });

  it("生产的登记表：槽位都在顺序表里，同一槽位同一组没有登记两件", () => {
    expect(pipelineProblems(ROUTE_MIDDLEWARES)).toEqual([]);
    expect(new Set(PIPELINE_ORDER).size).toBe(PIPELINE_ORDER.length);
    // 约定 C7 写明的相对先后
    const at = (slot: PipelineSlot) => PIPELINE_ORDER.indexOf(slot);
    const c7: PipelineSlot[] = [
      "versionGate",
      "auth",
      "membership",
      "consent",
      "stepUp",
      "featureFlag",
      "rateLimit",
      "idempotency",
    ];
    expect([...c7].sort((a, b) => at(a) - at(b))).toEqual(c7);
    // D4 第 7.4 节：访问面在鉴权之前；请求头检查、授权在鉴权之后、再验证之前
    expect(at("surface")).toBeLessThan(at("auth"));
    expect(at("auth")).toBeLessThan(at("csrf"));
    expect(at("csrf")).toBeLessThan(at("authz"));
    expect(at("authz")).toBeLessThan(at("stepUp"));
  });
});

describe("按组登记", () => {
  it("同一个槽位各组各登记一件：路由只拿到自己那一组的", TIMEOUT, async () => {
    const { request } = await testApi.start({
      handlers: [adminListHandler, hookReceiveHandler],
      middlewares: [
        tracer("auth", ["m"]),
        tracer("surface", ["admin"]),
        tracer("signature", ["hooks"]),
      ],
    });
    expect((await request("/api/v1/admin/lyxtest-things")).headers.get("x-trace")).toBe("surface");
    expect(
      (await request("/api/v1/hooks/lyxtest/events", { method: "POST" })).headers.get("x-trace"),
    ).toBe("signature");
  });

  it("同一个槽位同一组登记了两件、槽位不在顺序表里：建应用即失败", TIMEOUT, async () => {
    const twice = await testApi
      .start({
        pipeline: [...ROUTE_MIDDLEWARES, tracer("auth", ["m", "admin"]), tracer("auth", ["m"])],
      })
      .catch((error: unknown) => error);
    expect(twice).toBeInstanceOf(MountError);
    expect((twice as MountError).issues).toEqual(["装配：槽位 auth 在 m 组登记了不止一件"]);

    const unknown = await testApi
      .start({ pipeline: [...ROUTE_MIDDLEWARES, stubMiddleware("bodyLimit" as PipelineSlot)] })
      .catch((error: unknown) => error);
    expect(unknown).toBeInstanceOf(MountError);
    expect((unknown as MountError).issues).toEqual([
      "装配：没有 bodyLimit 这个槽位（先后在 routing/pipeline.ts 的 PIPELINE_ORDER 里定）",
    ]);
  });
});

describe("别处不另挂中间件", () => {
  const SRC = fileURLToPath(new URL("../src/", import.meta.url));
  /** 源码里挂中间件的两种写法：应用上的 .use(、路由配置里的 middleware: */
  const mountsIn = (source: string): string[] =>
    [/\.use\(/, /\bmiddleware:/].filter((pattern) => pattern.test(source)).map(String);

  it("apps/api/src 下只有 app.ts 调 .use(，只有 routing/mount.ts 写路由的 middleware:", () => {
    const found: Record<string, string[]> = {};
    for (const entry of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts"))
        continue;
      const path = join(entry.parentPath, entry.name);
      const file = relative(SRC, path).replaceAll("\\", "/");
      // 注释里提到写法的不算
      const code = readFileSync(path, "utf8").replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
      const mounts = mountsIn(code);
      if (mounts.length > 0) found[file] = mounts;
    }
    expect(found).toEqual({
      "app.ts": [String(/\.use\(/)],
      "routing/mount.ts": [String(/\bmiddleware:/)],
    });
  });

  it("这道扫描认得出两种写法", () => {
    expect(mountsIn('app.use("*", something());')).toHaveLength(1);
    expect(mountsIn("const withChain = { ...route, middleware: [mine] };")).toHaveLength(1);
    expect(mountsIn("export const mine: RouteMiddlewareFactory = () => null;")).toEqual([]);
  });
});
