// “声明即挂载”的核对（任务书 W0-22 第 7 节第 3 条、W0-22b 第 7 节第 3 条；约定 C75）：
// 路由声明了什么就得挂上什么中间件，漏挂即建应用失败（进程起不来），报错点名路由与缺的中间件。
import { uuidv7 } from "@liyoxi/services";
import { describe, expect, it } from "vitest";

import { HANDLERS } from "../src/routes/index.js";
import { MountError } from "../src/routing/mount.js";
import { PIPELINE_ORDER, ROUTE_MIDDLEWARES } from "../src/routing/pipeline.js";
import { MIDDLEWARE_REQUIREMENTS } from "../src/routing/requirements.js";
import { fakeAuth, stubMiddleware, useTestApi } from "../src/testing/index.js";
import type { TestApiOptions } from "../src/testing/index.js";

import {
  adminListHandler,
  capabilityHandler,
  hookReceiveHandler,
  portalGetHandler,
  rateLimitedHandler,
  thingGetHandler,
  thingUpdateHandler,
  unknownTierHandler,
} from "./fixtures.js";

const testApi = useTestApi();
const TIMEOUT = { timeout: 60_000 };

const auth = fakeAuth({
  actor: { type: "merchant", id: uuidv7(), client: "weapp", role: "owner" },
});
const without = (slot: string) => ROUTE_MIDDLEWARES.filter((entry) => entry.slot !== slot);
const NO_RATE_LIMIT =
  "声明了 x-rate-limit（档位按 operationId 登记，约定 C68），装配里没有中间件 rateLimit";

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

  it("声明了能力点而没有鉴权与授权中间件", TIMEOUT, async () => {
    expect(await issuesOf({ handlers: [capabilityHandler] })).toEqual([
      "m.lyxtestThing.guarded：声明了 x-auth（optional、user、member、staff、portal），装配里没有中间件 auth",
      "m.lyxtestThing.guarded：声明了 x-capability / x-permission，装配里没有中间件 authz",
    ]);
  });

  it(
    "装配里摘掉了限流：自己写了档位的、只受所在组缺省档位约束的、回调，每条都报",
    TIMEOUT,
    async () => {
      expect(
        await issuesOf({
          handlers: [
            rateLimitedHandler,
            thingGetHandler,
            adminListHandler,
            portalGetHandler,
            hookReceiveHandler,
          ],
          pipeline: [...without("rateLimit"), stubMiddleware("signature")],
        }),
      ).toEqual([
        `m.lyxtestThing.limited：${NO_RATE_LIMIT}`,
        `m.lyxtestThing.get：${NO_RATE_LIMIT}`,
        `admin.lyxtestThing.list：${NO_RATE_LIMIT}`,
        `portal.lyxtestThing.get：${NO_RATE_LIMIT}`,
        `hooks.lyxtest.event.receive：${NO_RATE_LIMIT}`,
      ]);
    },
  );

  it("档位没有额度、路由写了没登记的档位：限流中间件配不上，同样起不来", TIMEOUT, async () => {
    expect(
      await issuesOf({
        handlers: [thingGetHandler, adminListHandler],
        rateLimitQuotas: { "admin.global": [{ by: "session", limit: 5, windowSec: 60 }] },
      }),
    ).toEqual([
      "m.lyxtestThing.get：中间件 rateLimit 配不上：限流档位 m.global 没有额度（额度表里补上这个档位）",
    ]);
    expect(await issuesOf({ handlers: [unknownTierHandler] })).toEqual([
      "m.lyxtestThing.unknownTier：中间件 rateLimit 配不上：x-rate-limit 写的档位 m.lyxtest_nope 没有登记（packages/contract 的 RATE_LIMIT_TIERS）",
    ]);
    expect(
      await issuesOf({
        handlers: [thingGetHandler],
        rateLimitQuotas: {
          "m.global": [{ by: "param", param: "orderId", limit: 1, windowSec: 3 }],
        },
      }),
    ).toEqual([
      "m.lyxtestThing.get：中间件 rateLimit 配不上：限流档位 m.global 的规则写得不对：路径里没有参数 orderId",
    ]);
  });

  it("装配里摘掉了幂等上下文：每条路由都报", TIMEOUT, async () => {
    expect(
      await issuesOf({
        handlers: [thingGetHandler, adminListHandler],
        pipeline: without("idempotency"),
      }),
    ).toEqual([
      "m.lyxtestThing.get：声明了 x-idempotent，装配里没有中间件 idempotency",
      "admin.lyxtestThing.list：声明了 x-idempotent，装配里没有中间件 idempotency",
    ]);
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
  it("补上鉴权、验签、授权的顶替件：声明了的都挂上了", TIMEOUT, async () => {
    const { api, request } = await testApi.start({
      handlers: [thingUpdateHandler, hookReceiveHandler, capabilityHandler, rateLimitedHandler],
      middlewares: [auth, stubMiddleware("signature"), stubMiddleware("authz")],
    });
    for (const route of api.mounted) {
      expect(route.middlewares).toEqual(["auth", "signature", "authz", "rateLimit", "idempotency"]);
    }
    expect((await request("/api/v1/m/lyxtest-things/guarded")).status).toBe(200);
    expect((await request("/api/v1/m/lyxtest-things/limited")).status).toBe(200);
  });

  it("生产的处理器清单配生产的装配：现在就起得来；规则表要的中间件都有槽位", TIMEOUT, async () => {
    const { api } = await testApi.start();
    // 起得来即挂载核对通过：生产清单里的处理器一条不落都挂上了（W1-03 起清单不再是空的）
    expect(api.mounted.map((route) => route.operationId).sort()).toEqual(
      HANDLERS.map((entry) => entry.route.operationId).sort(),
    );
    const slots = ROUTE_MIDDLEWARES.map((entry) => entry.slot);
    expect(slots).toEqual(expect.arrayContaining(["rateLimit", "idempotency"]));
    for (const requirement of MIDDLEWARE_REQUIREMENTS) {
      expect(PIPELINE_ORDER).toContain(requirement.slot);
    }
  });
});
