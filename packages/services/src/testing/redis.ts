// Redis 的测试隔离（W0-05b）：按键前缀隔离，不按库号。库号只有 16 个，会话数乘 worker 数不够分。
//
// 前缀：lyx:test:<会话标识>:<worker 编号>:，落在 D7 第 2.5 节的 lyx:{env}: 之下（env 取 test）。
// 一个 worker 一个前缀，前缀之间互不包含：清空一个，碰不到另一个。
// “清空”只清自己前缀下的键：SCAN 加 UNLINK，不用 FLUSHDB、FLUSHALL——共享的那份 Redis 上还有别的会话、
// 别的 worker 与本地开发的键。前缀同样有守卫：不是 lyx:test:<会话>:<worker>: 这个形状的，一条命令都不发。
//
// 用法：测试文件顶层写 `const redis = useTestRedis();`，用例里 `const client = await redis.client()`。
// 连接串取环境变量 REDIS_URL（CLAUDE.md 第 9 节），不读 .env。
// BullMQ 不认 ioredis 的 keyPrefix，要用它自己的 prefix 选项：写 `${redis.prefix}bull`，连接用 redis.raw()。

import {
  assertTestScaffoldAttached,
  recordTestUsage,
  resolveTestSession,
  resolveTestWorker,
} from "@liyoxi/db/testing";
import { Redis } from "ioredis";
import type { RedisOptions } from "ioredis";
import { aroundAll } from "vitest";

/** 测试键的总前缀 */
export const TEST_REDIS_PREFIX = "lyx:test:";

const OWN_PREFIX = /^lyx:test:[a-z0-9]{1,12}:[0-9]{1,4}:$/;

/** 前缀没过守卫 */
export class TestRedisPrefixError extends Error {
  constructor(prefix: unknown) {
    super(
      `测试支架只清 ${TEST_REDIS_PREFIX}<会话标识>:<worker 编号>: 之下的键，拒绝：${JSON.stringify(prefix)}`,
    );
    this.name = "TestRedisPrefixError";
  }
}

/** 前缀守卫：清空之前先过它 */
export function assertTestRedisPrefix(prefix: unknown): asserts prefix is string {
  if (typeof prefix !== "string" || !OWN_PREFIX.test(prefix))
    throw new TestRedisPrefixError(prefix);
}

export interface TestRedisPrefixParts {
  session?: string;
  worker?: string;
}

/** 本 worker 的键前缀：lyx:test:<会话标识>:<worker 编号>: */
export function testRedisPrefix(parts: TestRedisPrefixParts = {}): string {
  const session = parts.session ?? resolveTestSession();
  const worker = parts.worker ?? resolveTestWorker();
  const prefix = `${TEST_REDIS_PREFIX}${session}:${worker}:`;
  assertTestRedisPrefix(prefix);
  return prefix;
}

function redisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      "REDIS_URL 未设置：要连本地的 Redis（pnpm infra:up；取值见 CLAUDE.md 第 9 节）",
    );
  }
  return url;
}

/**
 * 清空一个前缀下的全部键，返回删了几个。只用 SCAN 与 UNLINK。
 * @param redis 不带 keyPrefix 的连接（带了的话 UNLINK 会再套一层前缀，删不到）
 */
export async function flushTestRedis(redis: Redis, prefix: string): Promise<number> {
  assertTestRedisPrefix(prefix);
  if (redis.options.keyPrefix) {
    throw new Error("flushTestRedis 要一条不带 keyPrefix 的连接");
  }
  let cursor = "0";
  let removed = 0;
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 500);
    cursor = next;
    // 再核一遍：只删确实以本前缀开头的
    const own = keys.filter((key) => key.startsWith(prefix));
    if (own.length > 0) removed += await redis.unlink(...own);
  } while (cursor !== "0");
  return removed;
}

/** 等一条连接断开的时限。平时几毫秒；ioredis 自己到 2 秒还没关掉就强行关，这里再留些余量 */
const DISCONNECT_TIMEOUT_MS = 10_000;
/** 到点之后强行关掉 socket，再等它这么久 */
const DESTROY_GRACE_MS = 1_000;

/** 做一个动作，然后等连接的 end 事件，最多等 ms 毫秒。等到了返回 true */
function endsWithin(client: Redis, ms: number, act: () => void): Promise<boolean> {
  return new Promise((resolve) => {
    const onEnd = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      client.off("end", onEnd);
      resolve(false);
    }, ms);
    client.once("end", onEnd);
    act();
  });
}

/**
 * 断开一条连接，等它真的断开再返回。
 * ioredis 的 disconnect() 只是发起断开：状态要等对端把连接关掉才变成 end，机器忙的时候晚到几十毫秒是常事。
 * 自己另建的连接（BullMQ 的、订阅用的）收尾时也用它，不要 disconnect() 完就当它断了。
 *
 * 返回时的状态一般是 end。例外是正等着重连的连接：它的 socket 早就关了，这里只取消重连，
 * ioredis 不会再发 end 事件，状态就停在 reconnecting——连接不会再起来，也发不出命令。
 *
 * 到点（timeoutMs，缺省 10 秒）还没断开：强行关掉底下的 socket，然后抛错。对端不配合，连接也不留着。
 */
export async function disconnectTestRedis(
  client: Redis,
  timeoutMs: number = DISCONNECT_TIMEOUT_MS,
): Promise<void> {
  if (client.status === "end") return;
  if (client.status === "reconnecting") {
    client.disconnect();
    return;
  }
  if (await endsWithin(client, timeoutMs, () => client.disconnect())) return;
  const stuckAt = client.status;
  // 还没连上过的连接没有 socket，类型声明里没写这一点
  const socket: { destroy(): unknown } | undefined = client.stream;
  await endsWithin(client, DESTROY_GRACE_MS, () => socket?.destroy());
  throw new Error(`Redis 连接 ${timeoutMs} 毫秒内没有断开（状态停在 ${stuckAt}），已强行关掉`);
}

export interface TestRedis {
  /** 本 worker 的键前缀 */
  readonly prefix: string;
  /** 带前缀的连接：键自动套上本 worker 的前缀。首次调用时先清掉这个前缀下上一轮的残留 */
  client(options?: RedisOptions): Promise<Redis>;
  /** 不带前缀的连接：给 BullMQ 这类自己管前缀的库用，键名自己拼上 prefix */
  raw(options?: RedisOptions): Promise<Redis>;
  /** 清空本前缀下的键，返回删了几个。别的前缀、不带测试前缀的键都不动 */
  flush(): Promise<number>;
}

/** 一个前缀从用到收尾。useTestRedis 把它挂到 Vitest 的钩子上；单独用时自己调 dispose */
export class TestRedisHandle implements TestRedis {
  readonly prefix: string;
  #admin: Redis | undefined;
  #ready: Promise<void> | undefined;
  readonly #clients: Redis[] = [];

  constructor(prefix: string) {
    assertTestRedisPrefix(prefix);
    this.prefix = prefix;
  }

  #prepare(): Promise<void> {
    this.#ready ??= (async () => {
      this.#admin = new Redis(redisUrl());
      await flushTestRedis(this.#admin, this.prefix);
      recordTestUsage("redis", this.prefix);
    })();
    return this.#ready;
  }

  async client(options: RedisOptions = {}): Promise<Redis> {
    await this.#prepare();
    const client = new Redis(redisUrl(), { ...options, keyPrefix: this.prefix });
    this.#clients.push(client);
    return client;
  }

  async raw(options: RedisOptions = {}): Promise<Redis> {
    await this.#prepare();
    const client = new Redis(redisUrl(), { ...options, keyPrefix: undefined });
    this.#clients.push(client);
    return client;
  }

  async flush(): Promise<number> {
    await this.#prepare();
    return flushTestRedis(this.#admin as Redis, this.prefix);
  }

  /**
   * 收尾：断开发出去的全部连接，清空本前缀。
   * 先断开、后清空：断干净了，就不会再有命令往这个前缀下写。返回时这些连接是什么状态见 disconnectTestRedis。
   * 有连接到点还没断开（它已被强行关掉）：本前缀照样清空，清完再把那个错抛出来，键不留在共享的 Redis 上。
   * @param options.disconnectTimeoutMs 等每条连接断开的时限，缺省 10 秒
   */
  async dispose(options: { disconnectTimeoutMs?: number } = {}): Promise<void> {
    if (!this.#ready) return;
    await this.#ready.catch(() => {});
    const clients = this.#clients.splice(0);
    const admin = this.#admin;
    this.#admin = undefined;
    this.#ready = undefined;
    const closed = await Promise.allSettled(
      clients.map((client) => disconnectTestRedis(client, options.disconnectTimeoutMs)),
    );
    try {
      if (admin) await flushTestRedis(admin, this.prefix);
    } finally {
      if (admin) await disconnectTestRedis(admin, options.disconnectTimeoutMs);
    }
    for (const result of closed) {
      if (result.status === "rejected") throw result.reason;
    }
  }
}

/** 收尾钩子的时限：断开每条连接最多等 10 秒，再加清空 */
const DISPOSE_TIMEOUT_MS = 60_000;

/**
 * 给当前测试文件本 worker 的 Redis 前缀。在文件顶层（或 describe 里）调用：它登记一个 aroundAll，
 * 把这一组用例连同它的 beforeAll、afterAll 整个包在里面，跑完之后断开并清空。
 * 不用 afterAll 收尾：别的 afterAll 先抛了错，排在后面的就不执行了，键会留在共享的 Redis 上
 *（测试库的收尾是同一个办法，见 @liyoxi/db/testing 的 useTestDatabase）。
 * 本包的 vitest.config.ts 要挂测试支架的 globalSetup，只连 Redis、不连库的包也一样（没挂即抛错）。
 */
export function useTestRedis(): TestRedis {
  assertTestScaffoldAttached();
  const handle = new TestRedisHandle(testRedisPrefix());
  // 回调只写一个参数：Vitest 会解析回调的参数表
  aroundAll(async (runSuite) => {
    try {
      await runSuite();
    } finally {
      await handle.dispose();
    }
  }, DISPOSE_TIMEOUT_MS);
  return handle;
}
