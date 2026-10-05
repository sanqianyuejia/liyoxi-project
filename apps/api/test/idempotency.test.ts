// 幂等上下文的接口层用例（任务书 W0-22 第 7 节第 2 条；约定 C47–C50）。连真库：幂等行与业务写在同一个事务里。
import { uuidv7 } from "@liyoxi/services";
import { describe, expect, it } from "vitest";

import { fakeAuth, stubMiddleware, useTestApi } from "../src/testing/index.js";

import { executions, SAMPLE_HANDLERS, thingTouchHandler } from "./fixtures.js";

const testApi = useTestApi();
const TIMEOUT = { timeout: 60_000 };

const userId = uuidv7();
const start = () =>
  testApi.start({
    handlers: [...SAMPLE_HANDLERS, thingTouchHandler],
    middlewares: [
      fakeAuth({ actor: { type: "merchant", id: userId, client: "weapp", role: "owner" } }),
      stubMiddleware("signature"),
    ],
  });

const put = (thingId: string, key: string | null, json: unknown, storeId?: string) => ({
  path: `/api/v1/m/lyxtest-things/${thingId}`,
  init: {
    method: "PUT",
    json,
    headers: {
      ...(key === null ? {} : { "Idempotency-Key": key }),
      ...(storeId === undefined ? {} : { "X-Store-Id": storeId }),
    },
  },
});

describe("x-idempotent: required", () => {
  it("缺键、键的格式不对：400 IDEMPOTENCY_KEY_REQUIRED，处理器没有执行", TIMEOUT, async () => {
    const { request } = await start();
    const before = executions.update;
    for (const key of [null, "has space", "update:a/b", "x".repeat(129)]) {
      const { path, init } = put(uuidv7(), key, { name: "样例", count: 1 });
      const response = await request(path, init);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: 40002,
        error: "IDEMPOTENCY_KEY_REQUIRED",
      });
    }
    expect(executions.update).toBe(before);
  });

  it(
    "同键重放：不再执行处理器里的业务，返回上次的结果，回包头带 Idempotent-Replayed",
    TIMEOUT,
    async () => {
      const { request } = await start();
      const prisma = await testApi.db.prisma();
      const thingId = uuidv7();
      const { path, init } = put(thingId, `update:${uuidv7()}`, { name: "第一次", count: 3 });
      const before = executions.update;

      const first = await request(path, init);
      expect(first.status).toBe(200);
      expect(first.headers.get("Idempotent-Replayed")).toBeNull();
      const firstBody = await first.json();

      const replay = await request(path, init);
      expect(replay.status).toBe(200);
      expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
      expect(await replay.json()).toEqual(firstBody);

      expect(executions.update).toBe(before + 1);
      const written = await prisma.outboxEvent.count({
        where: {
          eventType: "lyxtest.thing_updated",
          payload: { path: ["thingId"], equals: thingId },
        },
      });
      expect(written).toBe(1);
      const records = await prisma.idempotencyRecord.findMany({
        where: { scope: "m.lyxtestThing.update", actorKey: `merchant:${userId}` },
      });
      expect(records.some((record) => record.state === "done")).toBe(true);
    },
  );

  it("同键、请求内容或门店不同：409 IDEMPOTENCY_KEY_REUSED", TIMEOUT, async () => {
    const { request } = await start();
    const thingId = uuidv7();
    const key = `update:${uuidv7()}`;
    const storeA = uuidv7();
    const first = put(thingId, key, { name: "原样", count: 1 }, storeA);
    expect((await request(first.path, first.init)).status).toBe(200);

    const changedBody = put(thingId, key, { name: "改了", count: 1 }, storeA);
    const reused = await request(changedBody.path, changedBody.init);
    expect(reused.status).toBe(409);
    expect(await reused.json()).toMatchObject({ code: 40903, error: "IDEMPOTENCY_KEY_REUSED" });

    const otherStore = put(thingId, key, { name: "原样", count: 1 }, uuidv7());
    expect((await request(otherStore.path, otherStore.init)).status).toBe(409);

    const otherThing = put(uuidv7(), key, { name: "原样", count: 1 }, storeA);
    expect((await request(otherThing.path, otherThing.init)).status).toBe(409);
  });

  it("业务失败不留幂等行：入参不合被拒之后，同一个键改对了再发照常执行", TIMEOUT, async () => {
    const { request } = await start();
    const thingId = uuidv7();
    const key = `update:${uuidv7()}`;
    const bad = put(thingId, key, { name: "", count: 1 });
    expect((await request(bad.path, bad.init)).status).toBe(400);
    const good = put(thingId, key, { name: "改对了", count: 1 });
    const response = await request(good.path, good.init);
    expect(response.status).toBe(200);
    expect(response.headers.get("Idempotent-Replayed")).toBeNull();
  });

  it("防漏用：处理器没把幂等上下文交给 tx.run，成功返回也按出错算", TIMEOUT, async () => {
    const { request, logs } = await start();
    const response = await request("/api/v1/m/lyxtest-things/forgetful", {
      method: "POST",
      headers: { "Idempotency-Key": `forgetful:${uuidv7()}` },
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "INTERNAL" });
    expect(logs.find((entry) => entry.evt === "http.error")).toMatchObject({
      err: { message: expect.stringContaining("m.lyxtestThing.forgetful") as unknown },
    });
  });
});

describe("没有请求体的写接口", () => {
  const touch = (thingId: string, key: string, init: { contentType?: string; body?: string }) => ({
    path: `/api/v1/m/lyxtest-things/${thingId}/touch`,
    init: {
      method: "POST",
      headers: {
        "Idempotency-Key": key,
        ...(init.contentType === undefined ? {} : { "Content-Type": init.contentType }),
      },
      ...(init.body === undefined ? {} : { body: init.body }),
    },
  });

  it(
    "带 Content-Type: application/json 而请求体为空：照常执行；与不带这个请求头的同键请求互为重放",
    TIMEOUT,
    async () => {
      const { request } = await start();
      const thingId = uuidv7();
      const key = `touch:${uuidv7()}`;
      const before = executions.touch;

      // 小程序的 wx.request 缺省带这个请求头
      const withHeader = touch(thingId, key, { contentType: "application/json" });
      const first = await request(withHeader.path, withHeader.init);
      expect(first.status).toBe(200);
      expect(first.headers.get("Idempotent-Replayed")).toBeNull();

      const bare = touch(thingId, key, {});
      const replay = await request(bare.path, bare.init);
      expect(replay.status).toBe(200);
      expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
      expect(await replay.json()).toEqual(await first.json());

      const blank = touch(thingId, key, { contentType: "application/json", body: "  \n" });
      expect((await request(blank.path, blank.init)).headers.get("Idempotent-Replayed")).toBe(
        "true",
      );
      expect(executions.touch).toBe(before + 1);
    },
  );

  it("请求体不是合法的 JSON 仍是 400；带了内容的同键请求算另一个请求", TIMEOUT, async () => {
    const { request } = await start();
    const thingId = uuidv7();
    const key = `touch:${uuidv7()}`;
    const broken = touch(thingId, key, { contentType: "application/json", body: "{oops" });
    const rejected = await request(broken.path, broken.init);
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ error: "VALIDATION_FAILED" });

    const empty = touch(thingId, key, { contentType: "application/json" });
    expect((await request(empty.path, empty.init)).status).toBe(200);
    const withBody = touch(thingId, key, { contentType: "application/json", body: '{"x":1}' });
    expect((await request(withBody.path, withBody.init)).status).toBe(409);
  });
});

describe("natural 与 none", () => {
  it("不要键、不读写幂等表，处理器照常执行", TIMEOUT, async () => {
    const { request } = await start();
    const prisma = await testApi.db.prisma();
    const hook = await request("/api/v1/hooks/lyxtest/events", { method: "POST" });
    expect(hook.status).toBe(200);
    const read = await request(`/api/v1/m/lyxtest-things/${uuidv7()}`);
    expect(read.status).toBe(200);
    expect(read.headers.get("Idempotent-Replayed")).toBeNull();
    expect(
      await prisma.idempotencyRecord.count({ where: { scope: { startsWith: "hooks." } } }),
    ).toBe(0);
  });
});
