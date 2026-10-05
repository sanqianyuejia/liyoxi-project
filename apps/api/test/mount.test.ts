// “声明即挂载”的核对（任务书 W0-22 第 7 节第 3 条；约定 C75）：路由声明了什么就得挂上什么中间件，
// 漏挂即建应用失败（进程起不来），报错点名路由与缺的中间件。
import { uuidv7 } from "@liyoxi/services";
import { describe, expect, it } from "vitest";

import { MountError } from "../src/routing/mount.js";
import { ROUTE_PIPELINE } from "../src/routing/pipeline.js";
import { MIDDLEWARE_REQUIREMENTS } from "../src/routing/requirements.js";
import { fakeAuth, stubMiddleware, useTestApi } from "../src/testing/index.js";
import type { TestApiOptions } from "../src/testing/index.js";

import {
  adminListHandler,
  capabilityHandler,
  hookReceiveHandler,
  rateLimitedHandler,
  thingGetHandler,
  thingUpdateHandler,
} from "./fixtures.js";

const testApi = useTestApi();
const TIMEOUT = { timeout: 60_000 };

const auth = fakeAuth({
  actor: { type: "merchant", id: uuidv7(), client: "weapp", role: "owner" },
});

async function issuesOf(options: TestApiOptions): Promise<readonly string[]> {
  const failure = await testApi.start(options).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(MountError);
  return (failure as MountError).issues;
}

describe("漏挂中间件，建应用即失败", () => {
  it("要登录的路由没有鉴权中间件", TIMEOUT, async () => {
    expect(await issuesOf({ handlers: [thingUpdateHandler] })).toEqual([
      "m.lyxtestThing.update：声明了 x-auth（optional、user、member、staff、portal），装配里没有中间件 auth",
    ]);
  });

  it("回调没有验签中间件", TIMEOUT, async () => {
    expect(await issuesOf({ handlers: [hookReceiveHandler] })).toEqual([
      "hooks.lyxtest.event.receive：声明了 x-auth: signed，装配里没有中间件 signature",
    ]);
  });

  it("声明了能力点而没有鉴权与授权中间件；声明了限流档位而没有限流中间件", TIMEOUT, async () => {
    expect(await issuesOf({ handlers: [capabilityHandler, rateLimitedHandler] })).toEqual([
      "m.lyxtestThing.guarded：声明了 x-auth（optional、user、member、staff、portal），装配里没有中间件 auth",
      "m.lyxtestThing.guarded：声明了 x-capability / x-permission，装配里没有中间件 authz",
      "m.lyxtestThing.limited：声明了 x-rate-limit，装配里没有中间件 rateLimit",
    ]);
  });

  it("装配清单里摘掉了幂等上下文：每条路由都报", TIMEOUT, async () => {
    expect(await issuesOf({ handlers: [thingGetHandler, adminListHandler], pipeline: [] })).toEqual(
      [
        "m.lyxtestThing.get：声明了 x-idempotent，装配里没有中间件 idempotency",
        "admin.lyxtestThing.list：声明了 x-idempotent，装配里没有中间件 idempotency",
      ],
    );
  });

  it("不是契约构造器产出的路由、重复登记的处理器", TIMEOUT, async () => {
    const handmade = {
      route: { ...thingGetHandler.route, operationId: "m.handmade.get" },
      handler: thingGetHandler.handler,
    };
    expect(await issuesOf({ handlers: [handmade, thingGetHandler, thingGetHandler] })).toEqual([
      "m.handmade.get：不是契约构造器（merchantRoute、adminRoute、portalRoute、hookRoute）的产出",
      "m.lyxtestThing.get：登记了不止一个处理器",
    ]);
  });
});

describe("挂齐了就起得来", () => {
  it("各中间件按清单的先后排在处理器之前", TIMEOUT, async () => {
    const { api, request } = await testApi.start({
      handlers: [thingUpdateHandler, hookReceiveHandler, capabilityHandler, rateLimitedHandler],
      before: [
        auth,
        stubMiddleware("signature"),
        stubMiddleware("authz"),
        stubMiddleware("rateLimit"),
      ],
    });
    for (const route of api.mounted) {
      expect(route.middlewares).toEqual(["auth", "signature", "authz", "rateLimit", "idempotency"]);
    }
    expect((await request("/api/v1/m/lyxtest-things/guarded")).status).toBe(200);
    expect((await request("/api/v1/m/lyxtest-things/limited")).status).toBe(200);
  });

  it("生产的处理器清单配生产的装配清单：现在就起得来", TIMEOUT, async () => {
    const { api } = await testApi.start();
    expect(api.mounted).toEqual([]);
    expect(ROUTE_PIPELINE).toHaveLength(1);
    expect(MIDDLEWARE_REQUIREMENTS.map((item) => item.middleware)).toEqual([
      "auth",
      "signature",
      "authz",
      "rateLimit",
      "idempotency",
    ]);
  });
});
