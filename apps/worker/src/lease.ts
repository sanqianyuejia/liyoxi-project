// 租约的续约循环与看门狗（W0-23）。依据：D7 第 7.6 节；15 分组 第 2.2 节；D7 第 10.3 节 C12。
//
// 续约：每 10 秒一次，走专用连接。续上且之前不是主 → 成为主；没续上且之前是主 → 降级。
// 看门狗：独立的定时器，每秒一次，只读本地变量、不等任何查询返回：
//   - 是主，且距上次续约成功超过 20 秒 → 降级（续约挂起不返回时就靠这一条）。
//   - 这次触发比预期晚了 10 秒以上（事件循环卡死）→ 记 error，退出进程，由外面拉起。
//   - 是主，且某个循环连续两个周期没有进展 → 记 error，退出进程。间隔 1 秒的循环一轮本来就可能跑过 2 秒
//     （一个事务的上限是 10 秒），所以“没有进展”另设 60 秒的下限。
// 租约只是减少重复劳动：降级晚几秒、两个实例短暂同时干活，都不影响正确性。
import { LEASE_RENEW_MS } from "@liyoxi/services";
import type { WorkerLease } from "@liyoxi/services";

import type { Logger } from "./log.js";
import type { Loop } from "./loop.js";

export interface LeaseTiming {
  /** 续约间隔 */
  readonly renewMs: number;
  /** 距上次续约成功超过这么久即降级 */
  readonly lostAfterMs: number;
  /** 看门狗间隔 */
  readonly watchdogMs: number;
  /** 看门狗晚到超过这么久即退出进程 */
  readonly lagExitMs: number;
  /** 循环“没有进展”的下限 */
  readonly stallFloorMs: number;
}

export const LEASE_TIMING: LeaseTiming = {
  renewMs: LEASE_RENEW_MS,
  lostAfterMs: 20_000,
  watchdogMs: 1_000,
  lagExitMs: 10_000,
  stallFloorMs: 60_000,
};

export interface LeaseKeeperOptions {
  readonly lease: Pick<WorkerLease, "renew" | "holder">;
  /** 看门狗盯的循环 */
  readonly loops: readonly Loop[];
  readonly onPromote: () => void;
  readonly onDemote: () => void;
  readonly logger: Logger;
  readonly timing?: Partial<LeaseTiming>;
  readonly monotonic?: () => number;
  /** 退出进程；用例换成记录 */
  readonly exit?: (code: number) => void;
}

export interface LeaseKeeper {
  readonly primary: boolean;
  /** 立刻续约一次，之后按间隔续约；同时起看门狗 */
  start(): void;
  /** 停续约与看门狗；不降级、不让出（由调用方按关停的顺序做） */
  stop(): void;
  /** 续约一次。上一次还没返回时不叠加 */
  renewOnce(): Promise<void>;
  /** 看门狗看一眼 */
  watch(): void;
}

export function createLeaseKeeper(options: LeaseKeeperOptions): LeaseKeeper {
  const { lease, loops, logger } = options;
  const timing = { ...LEASE_TIMING, ...options.timing };
  const monotonic = options.monotonic ?? (() => performance.now());
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let primary = false;
  let lastOk = Number.NEGATIVE_INFINITY;
  let renewing: Promise<void> | undefined;
  let expectedAt: number | undefined;
  let timers: NodeJS.Timeout[] = [];

  const demote = (reason: string): void => {
    primary = false;
    logger.warn({ holder: lease.holder, reason }, "不再是主：停循环，暂停消费");
    options.onDemote();
  };

  const renewOnce = (): Promise<void> => {
    renewing ??= lease
      .renew()
      .then(
        (held) => {
          if (held) {
            lastOk = monotonic();
            if (primary) return;
            primary = true;
            logger.info({ holder: lease.holder }, "成为主：起循环与消费");
            options.onPromote();
          } else if (primary) {
            demote("租约已被别的实例接任");
          }
        },
        // 续约没成（超时、连接断开）：不更新 lastOk，是不是还算主由看门狗按时间判断
        (error: unknown) => logger.warn({ err: error }, "续约失败"),
      )
      .finally(() => {
        renewing = undefined;
      });
    return renewing;
  };

  const watch = (): void => {
    const now = monotonic();
    const late = expectedAt === undefined ? 0 : now - expectedAt;
    expectedAt = now + timing.watchdogMs;
    if (late > timing.lagExitMs) {
      logger.error({ lateMs: Math.round(late) }, "事件循环卡住过，退出进程");
      return exit(1);
    }
    if (!primary) return;
    if (now - lastOk > timing.lostAfterMs) return demote("续约超过 20 秒没有成功");
    const stalled = loops.find(
      (loop) =>
        loop.running && now - loop.lastBeat > Math.max(2 * loop.intervalMs, timing.stallFloorMs),
    );
    if (stalled !== undefined) {
      logger.error({ loop: stalled.name }, "循环连续两个周期没有进展，退出进程");
      exit(1);
    }
  };

  return {
    get primary() {
      return primary;
    },
    start() {
      void renewOnce();
      timers = [
        setInterval(() => void renewOnce(), timing.renewMs),
        setInterval(watch, timing.watchdogMs),
      ];
    },
    stop() {
      for (const timer of timers) clearInterval(timer);
      timers = [];
      expectedAt = undefined;
    },
    renewOnce,
    watch,
  };
}
