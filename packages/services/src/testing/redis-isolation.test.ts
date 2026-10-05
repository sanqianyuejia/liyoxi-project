import { createHash } from "node:crypto";
import { connect, createServer } from "node:net";
import type { AddressInfo, Socket } from "node:net";

import { resolveTestSession, resolveTestWorker } from "@liyoxi/db/testing";
import { Redis } from "ioredis";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { runNestedVitest } from "./__fixtures__/nested.js";
import { createRedisOutage } from "./fault/index.js";
import {
  assertTestRedisPrefix,
  disconnectTestRedis,
  flushTestRedis,
  TestRedisHandle,
  TestRedisPrefixError,
  testRedisPrefix,
  useTestRedis,
} from "./redis.js";

// 连库、连 Redis、起子进程的用例：实例忙的时候（别的会话同时在跑）会慢，时限放宽，不用缺省的 5 秒
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

// Redis 的隔离（W0-05b 任务书 第 7 节第 6 条）：清空甲前缀后，乙前缀的键与不带测试前缀的键都还在。
// 连的是共享的那份 Redis，所以用例只动自己造的键：
//   甲 = 本 worker 的前缀；乙 = 一个造出来的“另一个 worker”的前缀（编号加 9000，撞不上真的 worker）；
//   “不带测试前缀的键”放在 lyx:selftest: 之下，带本会话与本 worker 的编号，用完自己删。

const session = resolveTestSession();
const worker = resolveTestWorker();
const a = useTestRedis();
const b = new TestRedisHandle(testRedisPrefix({ worker: String(9000 + Number(worker)) }));
/** 不在 lyx:test: 之下的键：清空哪个测试前缀都不该碰到它 */
const OUTSIDE = `lyx:selftest:w005b:${session}:${worker}:outside`;

const direct = new Redis(process.env.REDIS_URL ?? "");
const countOf = async (prefix: string) => (await direct.keys(`${prefix}*`)).length;

afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await b.dispose();
  await direct.del(OUTSIDE);
  await disconnectTestRedis(direct);
});

describe("Redis 按键前缀隔离", () => {
  it("前缀是 lyx:test:<会话标识>:<worker 编号>:，落在 lyx:{env}: 之下", () => {
    expect(a.prefix).toBe(`lyx:test:${session}:${worker}:`);
    expect(a.prefix).toBe(`lyx:test:${session}:${process.env.VITEST_POOL_ID}:`);
    expect(testRedisPrefix({ session: "s1", worker: "3" })).toBe("lyx:test:s1:3:");
    expect(b.prefix).not.toBe(a.prefix);
    expect(b.prefix.startsWith(a.prefix) || a.prefix.startsWith(b.prefix)).toBe(false);
  });

  it("带前缀的连接：键自动落在自己的前缀下，两个前缀各存各的", async () => {
    const [clientA, clientB] = [await a.client(), await b.client()];
    await clientA.set("counter", "1");
    await clientB.set("counter", "2");
    expect(await clientA.get("counter")).toBe("1");
    expect(await clientB.get("counter")).toBe("2");
    expect(await direct.get(`${a.prefix}counter`)).toBe("1");
    expect(await direct.get(`${b.prefix}counter`)).toBe("2");
  });

  it("清空甲前缀：甲的键全没了；乙前缀的键与不带测试前缀的键都还在", async () => {
    const [clientA, clientB] = [await a.client(), await b.client()];
    await a.flush();
    await b.flush();
    // 甲：字符串、哈希、列表、集合各来一些，个数超过一次 SCAN 的批量
    const fill = clientA.pipeline();
    for (let index = 0; index < 1200; index += 1) fill.set(`bulk:${index}`, String(index));
    fill.hset("hash", "field", "value").lpush("list", "x").sadd("set", "m");
    await fill.exec();
    await clientB.set("keep", "乙的键");
    await clientB.hset("keep:hash", "field", "value");
    await direct.set(OUTSIDE, "不带测试前缀的键");
    expect(await countOf(a.prefix)).toBe(1203);
    expect(await countOf(b.prefix)).toBe(2);

    const commands = vi.spyOn(Redis.prototype, "sendCommand");
    expect(await a.flush()).toBe(1203);
    const names = new Set(commands.mock.calls.map(([command]) => command.name.toLowerCase()));
    commands.mockRestore();
    // 清空只用了 SCAN 与 UNLINK，没有 FLUSHDB、FLUSHALL、KEYS
    expect([...names].sort()).toEqual(["scan", "unlink"]);

    expect(await countOf(a.prefix)).toBe(0);
    expect(await clientA.get("bulk:7")).toBeNull();
    expect(await countOf(b.prefix)).toBe(2);
    expect(await clientB.get("keep")).toBe("乙的键");
    expect(await clientB.hget("keep:hash", "field")).toBe("value");
    expect(await direct.get(OUTSIDE)).toBe("不带测试前缀的键");
    // 再清一次：没有可清的
    expect(await a.flush()).toBe(0);
  });

  it("收尾：清空自己的前缀并断开连接，别人的不动", async () => {
    const mine = new TestRedisHandle(testRedisPrefix({ worker: String(8000 + Number(worker)) }));
    const client = await mine.client();
    await client.set("leftover", "1");
    await (await b.client()).set("keep", "乙的键");
    await direct.set(OUTSIDE, "不带测试前缀的键");
    await mine.dispose();
    expect(client.status).toBe("end");
    expect(await countOf(mine.prefix)).toBe(0);
    expect(await direct.get(`${b.prefix}keep`)).toBe("乙的键");
    expect(await direct.get(OUTSIDE)).toBe("不带测试前缀的键");
  });

  it("首次取连接时先清掉这个前缀下上一轮的残留", async () => {
    const prefix = testRedisPrefix({ worker: String(7000 + Number(worker)) });
    await direct.set(`${prefix}stale`, "上一轮没收尾留下的");
    const handle = new TestRedisHandle(prefix);
    try {
      const client = await handle.client();
      expect(await client.get("stale")).toBeNull();
    } finally {
      await handle.dispose();
    }
  });
});

describe("useTestRedis 的收尾", () => {
  it(
    "嵌套跑一轮：支架之后登记的 afterAll 失败，收尾照样执行，键没有留下",
    { timeout: 120_000 },
    async () => {
      // 嵌套的一轮另用一个会话标识（由本会话、本 worker 算出来），它的前缀撞不上外层任何一个 worker 的
      const nested = `n${createHash("sha256").update(`${session}:${worker}`).digest("hex").slice(0, 11)}`;
      const prefix = testRedisPrefix({ session: nested, worker: "1" });
      try {
        const result = runNestedVitest("redis-after-all", {
          session: nested,
          env: { LYX_TEST_FIXTURE_PREFIX: prefix },
        });
        expect(result.status, result.output).toBe(1);
        expect(result.output).toContain("夹具：afterAll 就是要失败");
        // 夹具里那条用例过了：键确实写进了这个前缀
        expect(result.output).toMatch(/Tests\s+1 passed \(1\)/);
        expect(await direct.keys(`${prefix}*`)).toEqual([]);
      } finally {
        await flushTestRedis(direct, prefix);
      }
    },
  );
});

/**
 * 一个只做转发的口，对端关得慢：客户端发起断开之后，它拖 delayMs 毫秒才把连接关掉；给 "never" 就一直不关。
 * 慢机器上 Redis 一侧的回应晚到就是这个样子：CI 第一次跑 test:isolation 时，收尾返回了，连接还是 ready。
 */
async function slowClosingProxy(delayMs: number | "never") {
  const target = new URL(process.env.REDIS_URL ?? "");
  const sockets = new Set<Socket>();
  const server = createServer({ allowHalfOpen: true }, (downstream) => {
    const upstream = connect(Number(target.port || "6379"), target.hostname);
    for (const socket of [downstream, upstream]) {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => sockets.delete(socket));
    }
    downstream.pipe(upstream, { end: false });
    upstream.pipe(downstream, { end: false });
    downstream.on("end", () => {
      if (delayMs === "never") return;
      setTimeout(() => {
        upstream.destroy();
        downstream.end();
      }, delayMs);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = new URL(target.toString());
  url.hostname = "127.0.0.1";
  url.port = String((server.address() as AddressInfo).port);
  return {
    url: url.toString(),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      }),
  };
}

describe("断开连接", () => {
  it("收尾等连接真的断开才返回：对端关得慢也一样", async () => {
    const proxy = await slowClosingProxy(300);
    vi.stubEnv("REDIS_URL", proxy.url);
    try {
      const handle = new TestRedisHandle(
        testRedisPrefix({ worker: String(6000 + Number(worker)) }),
      );
      const [client, raw] = [await handle.client(), await handle.raw()];
      await client.set("slow", "1");
      expect(await raw.get(`${handle.prefix}slow`)).toBe("1");
      await handle.dispose();
      expect([client.status, raw.status]).toEqual(["end", "end"]);
      expect(await countOf(handle.prefix)).toBe(0);
    } finally {
      vi.unstubAllEnvs();
      await proxy.close();
    }
  });

  it("到点还没断开：强行关掉那条连接，自己前缀下的键照样清掉，然后报错", async () => {
    // 对端一直不关；ioredis 自己的强关（disconnectTimeout，缺省 2 秒）调到 60 秒，等于没有
    const proxy = await slowClosingProxy("never");
    const handle = new TestRedisHandle(testRedisPrefix({ worker: String(5000 + Number(worker)) }));
    try {
      // 管理连接照常连真的 Redis，只有 stuck 这一条走不关的转发口
      await handle.flush();
      vi.stubEnv("REDIS_URL", proxy.url);
      const stuck = await handle.client({ disconnectTimeout: 60_000 });
      vi.unstubAllEnvs();
      await stuck.set("leftover", "1");
      expect(await countOf(handle.prefix)).toBe(1);

      await expect(handle.dispose({ disconnectTimeoutMs: 300 })).rejects.toThrow(
        "Redis 连接 300 毫秒内没有断开（状态停在 ready），已强行关掉",
      );
      expect(stuck.status).toBe("end");
      expect(await countOf(handle.prefix)).toBe(0);
    } finally {
      vi.unstubAllEnvs();
      // 上面没走到收尾就失败了的话，这里补上；已经收过尾的再调一次什么都不做
      await handle.dispose({ disconnectTimeoutMs: 300 }).catch(() => {});
      await flushTestRedis(direct, handle.prefix);
      await proxy.close();
    }
  });

  it("disconnectTestRedis：连着的、正在连的、还没连的、已经断开的，返回时都是 end", async () => {
    const url = process.env.REDIS_URL ?? "";
    const ready = new Redis(url);
    expect(await ready.ping()).toBe("PONG");
    const connecting = new Redis(url);
    const waiting = new Redis(url, { lazyConnect: true });
    expect([ready.status, connecting.status, waiting.status]).toEqual([
      "ready",
      "connecting",
      "wait",
    ]);
    await Promise.all([ready, connecting, waiting].map((client) => disconnectTestRedis(client)));
    expect([ready.status, connecting.status, waiting.status]).toEqual(["end", "end", "end"]);
    // 已经断开的再断一次：什么都不做
    await disconnectTestRedis(ready);
    expect(ready.status).toBe("end");
  });

  it("disconnectTestRedis：正等着重连的连接不再重连，不会卡住；它的状态停在 reconnecting，不是 end", async () => {
    const outage = await createRedisOutage();
    const client = new Redis(outage.url, { retryStrategy: () => 50 });
    client.on("error", () => {});
    try {
      expect(await client.ping()).toBe("PONG");
      await outage.down();
      await vi.waitFor(() => expect(client.status).toBe("reconnecting"), {
        timeout: 15_000,
        interval: 10,
      });
      await disconnectTestRedis(client);
      // 转发口恢复之后，重连的定时器（50 毫秒）早该到点：它已经被取消，连接没有再起来
      await outage.up();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(client.status).toBe("reconnecting");
    } finally {
      client.disconnect();
      await outage.close();
    }
  });
});

describe("前缀守卫", () => {
  const REJECTED: unknown[] = [
    "",
    "*",
    "lyx:",
    "lyx:test:",
    "lyx:test:s1:", // 少 worker 编号
    "lyx:test:s1:3", // 少结尾的冒号
    "lyx:test:*:3:",
    "lyx:test:s1:3:extra:",
    "lyx:local:s1:3:",
    "lyx:prod:bull:",
    "bull:",
    undefined,
    null,
  ];

  it("不是 lyx:test:<会话>:<worker>: 这个形状的前缀：清空即抛错，一条命令都不发", async () => {
    const commands = vi.spyOn(direct, "sendCommand");
    for (const prefix of REJECTED) {
      expect(() => assertTestRedisPrefix(prefix)).toThrow(TestRedisPrefixError);
      await expect(flushTestRedis(direct, prefix as string)).rejects.toBeInstanceOf(
        TestRedisPrefixError,
      );
      expect(() => new TestRedisHandle(prefix as string)).toThrow(TestRedisPrefixError);
    }
    expect(commands).not.toHaveBeenCalled();
  });

  it("拿带 keyPrefix 的连接来清空：拒绝（UNLINK 会再套一层前缀，删不到）", async () => {
    const prefixed = await a.client();
    await expect(flushTestRedis(prefixed, a.prefix)).rejects.toThrow(/不带 keyPrefix/);
  });
});
