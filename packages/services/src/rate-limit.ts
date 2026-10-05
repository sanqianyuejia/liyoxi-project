// 限流器（W0-22b；约定 C68；D4 第 9.5 节；D7 第 7.3 节）。只管计数：按什么键、限多少由调用方（api 的限流中间件）给。
//
//   正常：Redis 上的固定窗口。一段 Lua 把“加一”与“首次设过期”原子做完（两条命令之间进程退出，计数键不会永不过期）；
//         一次请求的各条规则一次往返。
//   降级：Redis 命令报错或到时限没回，这一次改用进程内固定窗口（每个进程各算各的），限额减半（至少 1）；
//         随后的熔断时长内不再碰 Redis，到点再试，通了就回到 Redis 上。不放开，也不整体拒绝。
//
// 涉及钱与安全状态的计数（账号锁定、每日邀请数、短信的号码限频）不走这里，以数据库为准（约定 C68）。
// 为什么是包级文件：它要进程的 Redis 连接，由进程运行时（runtime.ts）建好经 runtime.rateLimiter 给应用层。
import type { Clock } from "./kernel/index.js";
import type { Logger } from "./logger.js";

/** 限流器用到的 Redis：只要 EVAL。ioredis 的客户端满足它 */
export interface RateLimitStore {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

/** 一条规则在这次请求上的计数 */
export interface RateLimitCheck {
  /** 计数键：调用方拼好，如 rl:m.global:ip:203.0.113.7:60（进程的键前缀由连接自己加） */
  readonly key: string;
  /** 一个窗口里最多几次（正整数） */
  readonly limit: number;
  /** 窗口长度，毫秒（正整数） */
  readonly windowMs: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** 超限时过多少秒再来：取超限的那几个窗口里剩得最久的，向上取整，至少 1；没超限是 0 */
  readonly retryAfterSec: number;
  /** 超限的规则在入参里的下标 */
  readonly exceeded: readonly number[];
  /** 这一次是不是用进程内计数算的 */
  readonly degraded: boolean;
}

export interface RateLimiter {
  /** 各条规则各记一次，返回放不放行。不抛错：Redis 出什么问题都落到进程内计数 */
  hit(checks: readonly RateLimitCheck[]): Promise<RateLimitDecision>;
  /** 现在是不是在降级 */
  readonly degraded: boolean;
}

export interface RateLimiterOptions {
  /** 给 null 即一直用进程内计数 */
  readonly store: RateLimitStore | null;
  /** 进程内的窗口与熔断按它计时；Redis 上的窗口按 Redis 自己的过期时间 */
  readonly clock: Clock;
  readonly logger?: Pick<Logger, "warn" | "info">;
  /** 等 Redis 一条命令的时限，缺省 200 毫秒（D7 第 7.3 节） */
  readonly commandTimeoutMs?: number;
  /** Redis 失败一次之后多久不再试，缺省 5 秒 */
  readonly breakerMs?: number;
  /** 进程内计数表的条数上限，缺省 5 万 */
  readonly maxMemoryEntries?: number;
}

/** KEYS 是各条规则的计数键，ARGV 是对应的窗口毫秒数；返回 [次数, 剩余毫秒, 次数, 剩余毫秒, …] */
export const RATE_LIMIT_SCRIPT = `
local out = {}
for i, key in ipairs(KEYS) do
  local window = tonumber(ARGV[i])
  local count = redis.call('INCR', key)
  local ttl = redis.call('PTTL', key)
  if count == 1 or ttl < 0 then
    redis.call('PEXPIRE', key, window)
    ttl = window
  end
  out[#out + 1] = count
  out[#out + 1] = ttl
end
return out
`;

/** 降级时的限额：减半，至少 1 */
export const degradedLimit = (limit: number): number => Math.max(1, Math.floor(limit / 2));

interface Counted {
  count: number;
  ttlMs: number;
}

class RedisUnavailable extends Error {}

function decide(
  checks: readonly RateLimitCheck[],
  counted: readonly Counted[],
  degraded: boolean,
): RateLimitDecision {
  const exceeded: number[] = [];
  let retryAfterMs = 0;
  checks.forEach((check, index) => {
    const { count, ttlMs } = counted[index] as Counted;
    if (count > (degraded ? degradedLimit(check.limit) : check.limit)) {
      exceeded.push(index);
      retryAfterMs = Math.max(retryAfterMs, ttlMs);
    }
  });
  return {
    allowed: exceeded.length === 0,
    retryAfterSec: exceeded.length === 0 ? 0 : Math.max(1, Math.ceil(retryAfterMs / 1000)),
    exceeded,
    degraded,
  };
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { store, clock, logger } = options;
  const commandTimeoutMs = options.commandTimeoutMs ?? 200;
  const breakerMs = options.breakerMs ?? 5_000;
  const maxMemoryEntries = options.maxMemoryEntries ?? 50_000;

  const memory = new Map<string, { count: number; resetAt: number }>();
  let openUntil = 0;
  let degraded = store === null;

  function countInMemory(check: RateLimitCheck, now: number): Counted {
    let entry = memory.get(check.key);
    if (entry === undefined || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + check.windowMs };
      // 重新放一遍：过期的键挪到末尾，表满了先删最早放进来的
      memory.delete(check.key);
      memory.set(check.key, entry);
      if (memory.size > maxMemoryEntries) prune(now);
    }
    entry.count += 1;
    return { count: entry.count, ttlMs: entry.resetAt - now };
  }

  function prune(now: number): void {
    for (const [key, entry] of memory) if (entry.resetAt <= now) memory.delete(key);
    for (const key of memory.keys()) {
      if (memory.size <= maxMemoryEntries) break;
      memory.delete(key);
    }
  }

  async function countInRedis(
    redis: RateLimitStore,
    checks: readonly RateLimitCheck[],
  ): Promise<Counted[]> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new RedisUnavailable("超时")), commandTimeoutMs);
    });
    const command = redis.eval(
      RATE_LIMIT_SCRIPT,
      checks.length,
      ...checks.map((check) => check.key),
      ...checks.map((check) => check.windowMs),
    );
    // 超时之后命令才失败的：没人等它了，接住免得成了没处理的拒绝
    command.catch(() => undefined);
    try {
      const raw = await Promise.race([command, timeout]);
      if (!Array.isArray(raw) || raw.length !== checks.length * 2) {
        throw new RedisUnavailable("返回的不是预期的结果");
      }
      return checks.map((_check, index) => {
        const count = Number(raw[index * 2]);
        const ttlMs = Number(raw[index * 2 + 1]);
        if (!Number.isFinite(count) || !Number.isFinite(ttlMs)) {
          throw new RedisUnavailable("返回的不是预期的结果");
        }
        return { count, ttlMs };
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    get degraded() {
      return degraded;
    },
    async hit(checks) {
      if (checks.length === 0) {
        return { allowed: true, retryAfterSec: 0, exceeded: [], degraded };
      }
      const now = clock.now().getTime();
      if (store !== null && now >= openUntil) {
        try {
          const counted = await countInRedis(store, checks);
          if (degraded) {
            degraded = false;
            memory.clear();
            logger?.info({ evt: "ratelimit.restored" }, "限流回到 Redis 上计数");
          }
          return decide(checks, counted, false);
        } catch (error) {
          openUntil = now + breakerMs;
          if (!degraded) {
            degraded = true;
            logger?.warn(
              { evt: "ratelimit.degraded", err: error },
              "限流用不了 Redis，改用进程内计数、限额减半",
            );
          }
        }
      }
      return decide(
        checks,
        checks.map((check) => countInMemory(check, now)),
        true,
      );
    },
  };
}
